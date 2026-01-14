/**
 * fsx.do - Managed filesystem service
 *
 * A virtual filesystem backed by Cloudflare Durable Objects with tiered storage.
 * This is the managed service layer built on @dotdo/fsx.
 *
 * @example
 * ```typescript
 * import { fs } from 'fsx.do'
 *
 * await fs.writeFile('/hello.txt', 'Hello, World!')
 * const content = await fs.readFile('/hello.txt', 'utf-8')
 * ```
 *
 * @example CLI
 * ```bash
 * npx fsx.do ls /
 * npx fsx.do cat /hello.txt
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Re-export core @dotdo/fsx
// =============================================================================

// Core types and classes from core/
export {
  // Backend interface
  type FsBackend,
  type BackendWriteResult,
  type BackendReadResult,
  type BackendOptions,
  MemoryBackend,
  // Classes
  Stats,
  Dirent,
  FileHandle,
  // FSx main API
  FSx,
  type FSxOptions,
  // Constants
  constants,
  type Constants,
} from './core/index.js'

// Re-export all type definitions
export type {
  // Core capability interface
  FsCapability,
  // Storage tier type
  StorageTier,
  // File statistics types
  FileStat,
  StatsInit,
  StatsLike,
  // Directory entry types
  DirentType,
  FileType,
  FileEntry,
  FileMode,
  // Operation options
  ReadOptions,
  WriteOptions,
  ListOptions,
  CopyOptions,
  MoveOptions,
  RemoveOptions,
  ReadStreamOptions,
  WriteStreamOptions,
  MkdirOptions,
  RmdirOptions,
  ReaddirOptions,
  WatchOptions,
  // Result types
  WriteResult,
  ReadResult,
  // Watcher
  FSWatcher,
  // Encoding and storage
  BufferEncoding,
  BlobRef,
} from './core/index.js'

// Errors from core/errors.js
export {
  FSError,
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  EACCES,
  EPERM,
  ENOTEMPTY,
  EBADF,
  EINVAL,
  ELOOP,
  ENAMETOOLONG,
  ENOSPC,
  EROFS,
  EBUSY,
  EMFILE,
  ENFILE,
  EXDEV,
} from './core/errors.js'

// Path utilities, glob, find, grep
export * from './core/path.js'
export { match, createMatcher, type MatchOptions } from './core/glob/match.js'
export { glob, GlobTimeoutError, GlobAbortedError, type GlobOptions } from './core/glob/glob.js'
export { find, type FindOptions, type FindResult } from './core/find/find.js'
export { grep, type GrepOptions, type GrepMatch, type GrepResult } from './core/grep/grep.js'

// Content-Addressable Storage
export {
  ContentAddressableFS,
  type CASObject,
  type CASStorage,
  type ObjectType,
} from './core/cas/content-addressable-fs.js'
export { sha1, sha256, bytesToHex, hexToBytes } from './core/cas/hash.js'
export { hashToPath, pathToHash } from './core/cas/path-mapping.js'

// Sparse checkout
export { parsePattern, type ParsedPattern } from './core/sparse/patterns.js'

// Config
export {
  createConfig,
  isReadOnly,
  defaultConfig,
  type FSxConfig,
  type FSxConfigOptions,
} from './core/config.js'

// =============================================================================
// Durable Object exports
// =============================================================================

export {
  FileSystemDO,
  FsModule,
  type FsModuleConfig,
  withFs,
  hasFs,
  getFs,
  type WithFsContext,
  type WithFsOptions,
  type WithFsDO,
  // Container executor
  CloudflareContainerExecutor,
  createContainerExecutor,
  createIsolatedExecutor,
  type ContainerBinding,
  type ContainerInstance,
  type ContainerExecutorConfig,
  type ContainerExecResult,
  type ExecOptions,
  type StreamingExecEvent,
  type StreamingExecSession,
  type ContainerState,
  type HasContainerExecutor,
  type WithExecContext,
} from './do/index.js'

// =============================================================================
// Storage backends
// =============================================================================

export {
  TieredFS,
  R2Storage,
  SQLiteMetadata,
  R2Backend,
  type R2BackendConfig,
} from './storage/index.js'

// =============================================================================
// Service Definition (for dotdo integration)
// =============================================================================

// import { createService } from 'dotdo'
// import { FileSystemDO } from './do/index.js'
// import App from './App.js'
// import Site from './Site.js'
//
// export default createService({
//   name: 'fsx',
//   DO: FileSystemDO,
//   App,
//   Site,
//   docs: import.meta.glob('./docs/*.mdx'),
// })

// For now, export the DO as default for wrangler
export { FileSystemDO as default } from './do/index.js'

// =============================================================================
// fs singleton and factory for SDK usage
// =============================================================================

import { FSx, type FSxOptions } from './core/fsx.js'
import { MemoryBackend, type FsBackend } from './core/backend.js'

/**
 * Configuration options for creating an FSx instance via the factory function.
 *
 * @see {@link createFs} for usage examples
 */
export interface CreateFsOptions extends FSxOptions {
  /**
   * Use a pre-existing FsBackend implementation.
   * When provided, the factory uses this backend for storage operations.
   * When omitted, an in-memory backend is used (suitable for testing/development).
   */
  backend?: FsBackend
}

/**
 * Create a new FSx filesystem instance with custom configuration.
 *
 * This factory function allows you to create filesystem instances with
 * different configurations or storage backends. Use this when you need:
 * - Multiple isolated filesystem instances
 * - Custom tier thresholds or file size limits
 * - Connection to a specific Durable Object binding
 *
 * @param options - Configuration options for the filesystem instance
 * @returns A configured FSx instance
 *
 * @example Create an in-memory filesystem (for testing)
 * ```typescript
 * import { createFs } from 'fsx.do'
 *
 * const testFs = createFs()
 * await testFs.writeFile('/test.txt', 'test content')
 * ```
 *
 * @example Create with custom configuration
 * ```typescript
 * import { createFs } from 'fsx.do'
 *
 * const fs = createFs({
 *   maxFileSize: 50 * 1024 * 1024, // 50MB limit
 *   defaultMode: 0o600,            // Restrictive permissions
 * })
 * ```
 *
 * @example Create with custom backend (production)
 * ```typescript
 * import { createFs, MemoryBackend } from 'fsx.do'
 *
 * // Use a custom backend implementation
 * const customBackend = new MemoryBackend()
 * const fs = createFs({ backend: customBackend })
 * const content = await fs.readFile('/data.json', 'utf-8')
 * ```
 */
export function createFs(options: CreateFsOptions = {}): FSx {
  const { backend, ...fsxOptions } = options

  // Use provided backend or create an in-memory one for development/testing
  const fsBackend = backend ?? new MemoryBackend()
  return new FSx(fsBackend, fsxOptions)
}

/**
 * Default filesystem singleton for SDK usage.
 *
 * This provides a ready-to-use filesystem instance backed by in-memory storage.
 * The singleton is ideal for quick prototyping, testing, and simple scripts.
 *
 * **Important:** Data stored in this singleton is ephemeral and will be lost
 * when the process ends. For persistent storage in production, use {@link createFs}
 * with a Durable Object binding.
 *
 * @example Basic file operations
 * ```typescript
 * import { fs } from 'fsx.do'
 *
 * // Write a file
 * await fs.writeFile('/hello.txt', 'Hello, World!')
 *
 * // Read a file
 * const content = await fs.readFile('/hello.txt', 'utf-8')
 * console.log(content) // 'Hello, World!'
 *
 * // Check if file exists
 * const exists = await fs.exists('/hello.txt')
 * console.log(exists) // true
 * ```
 *
 * @example Directory operations
 * ```typescript
 * import { fs } from 'fsx.do'
 *
 * // Create nested directories
 * await fs.mkdir('/app/data/logs', { recursive: true })
 *
 * // List directory contents
 * const files = await fs.readdir('/app/data')
 * console.log(files) // ['logs']
 *
 * // Get file stats
 * const stats = await fs.stat('/app/data')
 * console.log(stats.isDirectory()) // true
 * ```
 *
 * @example Import alongside types
 * ```typescript
 * import { fs, Stats, ENOENT } from 'fsx.do'
 *
 * try {
 *   const stats: Stats = await fs.stat('/missing.txt')
 * } catch (error) {
 *   if (error instanceof ENOENT) {
 *     console.log('File not found')
 *   }
 * }
 * ```
 */
export const fs: FSx = createFs()
