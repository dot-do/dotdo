/**
 * withFs Capability - Filesystem Capability for Durable Objects
 *
 * This capability adds the $.fs API to Durable Objects, providing a
 * SQLite-backed filesystem with tiered storage support (SQLite hot tier,
 * R2 warm/cold tiers).
 *
 * Uses the FsModule from fsx.do for the actual filesystem implementation.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withFs } from 'dotdo/mixins'
 *
 * class MySite extends withFs(DO) {
 *   async loadContent() {
 *     const content = await this.$.fs.read('/content/index.mdx', { encoding: 'utf-8' })
 *     const files = await this.$.fs.list('/content')
 *     return { content, files }
 *   }
 * }
 * ```
 *
 * @see dotdo-dipdv for design details
 */

import { createCapability, type Constructor, type CapabilityContext } from './infrastructure'
import { FsModule, type FsModuleConfig } from 'fsx.do'
import type {
  ReadOptions,
  WriteOptions,
  MkdirOptions,
  ReaddirOptions,
  Stats,
  Dirent,
  FSWatcher,
  WatchOptions,
  ReadStreamOptions,
  WriteStreamOptions,
  CopyOptions,
  MoveOptions,
  RemoveOptions,
  RmdirOptions,
  FileHandle,
  ListOptions,
} from 'fsx.do'

// Re-export FsModule for type access
export { FsModule } from 'fsx.do'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration options for the withFs capability
 */
export interface WithFsOptions {
  /** Base path prefix for all file operations (default: '/') */
  basePath?: string
  /** Maximum size in bytes for hot tier storage (default: 1MB) */
  hotMaxSize?: number
  /** Name of the R2 binding in the environment (default: 'R2') */
  r2BindingName?: string
  /** Name of the archive R2 binding for cold tier (default: 'ARCHIVE') */
  archiveBindingName?: string
}

/**
 * The filesystem capability API exposed on $.fs
 *
 * This interface provides a comprehensive POSIX-like API for filesystem
 * operations on Cloudflare Durable Objects with tiered storage support.
 */
export interface FsCapability {
  // File operations
  read(path: string, options?: ReadOptions): Promise<string | Uint8Array>
  write(path: string, content: string | Uint8Array, options?: WriteOptions): Promise<void>
  append(path: string, content: string | Uint8Array): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  rename(oldPath: string, newPath: string, options?: MoveOptions): Promise<void>
  copyFile(src: string, dest: string, options?: CopyOptions): Promise<void>
  truncate(path: string, length?: number): Promise<void>

  // Directory operations
  list(path: string, options?: ListOptions): Promise<string[] | Dirent[]>
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
  mkdir(path: string, options?: MkdirOptions): Promise<void>
  rmdir(path: string, options?: RmdirOptions): Promise<void>
  rm(path: string, options?: RemoveOptions): Promise<void>

  // Metadata operations
  stat(path: string): Promise<Stats>
  lstat(path: string): Promise<Stats>
  access(path: string, mode?: number): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  chown(path: string, uid: number, gid: number): Promise<void>
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>

  // Symbolic links
  symlink(target: string, path: string): Promise<void>
  link(existingPath: string, newPath: string): Promise<void>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>

  // Streaming operations
  createReadStream(path: string, options?: ReadStreamOptions): Promise<ReadableStream<Uint8Array>>
  createWriteStream(path: string, options?: WriteStreamOptions): Promise<WritableStream<Uint8Array>>

  // File handle operations
  open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>

  // Watch operations
  watch(path: string, options?: WatchOptions, listener?: (eventType: 'rename' | 'change', filename: string) => void): FSWatcher

  // Tiered storage operations
  getTier(path: string): Promise<'hot' | 'warm' | 'cold'>
  promote(path: string, tier: 'hot' | 'warm'): Promise<void>
  demote(path: string, tier: 'warm' | 'cold'): Promise<void>

  // Transaction operations
  transaction<T>(fn: () => Promise<T>): Promise<T>
  writeMany(files: Array<{ path: string; content: string | Uint8Array }>): Promise<void>
}

/**
 * Extended WorkflowContext type with fs capability
 */
export interface WithFsContext {
  fs: FsCapability
}

// ============================================================================
// CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * Create the capability initialization function for fs
 */
function createFsInit(options: WithFsOptions = {}) {
  const r2BindingName = options.r2BindingName ?? 'R2'
  const archiveBindingName = options.archiveBindingName ?? 'ARCHIVE'

  return (ctx: CapabilityContext): FsCapability => {
    // Get R2 bindings from environment
    const env = ctx.env as Record<string, unknown> | undefined
    const r2 = env?.[r2BindingName] as R2Bucket | undefined
    const archive = env?.[archiveBindingName] as R2Bucket | undefined

    // Create FsModule configuration
    const config: FsModuleConfig = {
      sql: ctx.state.storage.sql,
      r2,
      archive,
      basePath: options.basePath,
      hotMaxSize: options.hotMaxSize,
    }

    // Create the FsModule instance
    const fsModule = new FsModule(config)

    // Return the capability API that delegates to FsModule
    return {
      // File operations
      read: (path, opts) => fsModule.read(path, opts),
      write: (path, content, opts) => fsModule.write(path, content, opts),
      append: (path, content) => fsModule.append(path, content),
      exists: (path) => fsModule.exists(path),
      unlink: (path) => fsModule.unlink(path),
      rename: (oldPath, newPath, opts) => fsModule.rename(oldPath, newPath, opts),
      copyFile: (src, dest, opts) => fsModule.copyFile(src, dest, opts),
      truncate: (path, length) => fsModule.truncate(path, length),

      // Directory operations
      list: (path, opts) => fsModule.list(path, opts),
      readdir: (path, opts) => fsModule.readdir(path, opts),
      mkdir: (path, opts) => fsModule.mkdir(path, opts),
      rmdir: (path, opts) => fsModule.rmdir(path, opts),
      rm: (path, opts) => fsModule.rm(path, opts),

      // Metadata operations
      stat: (path) => fsModule.stat(path),
      lstat: (path) => fsModule.lstat(path),
      access: (path, mode) => fsModule.access(path, mode),
      chmod: (path, mode) => fsModule.chmod(path, mode),
      chown: (path, uid, gid) => fsModule.chown(path, uid, gid),
      utimes: (path, atime, mtime) => fsModule.utimes(path, atime, mtime),

      // Symbolic links
      symlink: (target, path) => fsModule.symlink(target, path),
      link: (existingPath, newPath) => fsModule.link(existingPath, newPath),
      readlink: (path) => fsModule.readlink(path),
      realpath: (path) => fsModule.realpath(path),

      // Streaming operations
      createReadStream: (path, opts) => fsModule.createReadStream(path, opts),
      createWriteStream: (path, opts) => fsModule.createWriteStream(path, opts),

      // File handle operations
      open: (path, flags, mode) => fsModule.open(path, flags, mode),

      // Watch operations
      watch: (path, opts, listener) => fsModule.watch(path, opts, listener),

      // Tiered storage operations
      getTier: (path) => fsModule.getTier(path),
      promote: (path, tier) => fsModule.promote(path, tier),
      demote: (path, tier) => fsModule.demote(path, tier),

      // Transaction operations
      transaction: (fn) => fsModule.transaction(fn),
      writeMany: (files) => fsModule.writeMany(files),
    }
  }
}

/**
 * Base capability without options - uses default configuration
 */
const baseFsCapability = createCapability<'fs', FsCapability>('fs', createFsInit())

/**
 * withFs capability - adds $.fs capability to a Durable Object class
 *
 * This capability provides filesystem operations backed by SQLite (hot tier)
 * and optionally R2 (warm/cold tiers) for larger files.
 *
 * @param Base - The base DO class to extend
 * @param options - Optional configuration for the filesystem capability
 * @returns Extended class with $.fs capability
 *
 * @example
 * ```typescript
 * // Basic usage
 * class MySite extends withFs(DO) {
 *   async handleRequest(req: Request) {
 *     const content = await this.$.fs.read('/index.html', { encoding: 'utf-8' })
 *     return new Response(content, { headers: { 'Content-Type': 'text/html' } })
 *   }
 * }
 *
 * // With custom options
 * class MyStorage extends withFs(DO, {
 *   basePath: '/data',
 *   r2BindingName: 'STORAGE_BUCKET',
 *   hotMaxSize: 512 * 1024, // 512KB
 * }) {
 *   async storeFile(name: string, content: Uint8Array) {
 *     await this.$.fs.write(name, content)
 *   }
 * }
 * ```
 */
export function withFs<TBase extends Constructor<{ ctx: DurableObjectState; env: unknown; $: unknown }>>(
  Base: TBase,
  options?: WithFsOptions
): TBase & Constructor<{ hasCapability(name: string): boolean }> {
  if (options) {
    // Create a new capability with custom options
    const customCapability = createCapability<'fs', FsCapability>('fs', createFsInit(options))
    return customCapability(Base)
  }

  // Use the base capability with default options
  return baseFsCapability(Base)
}
