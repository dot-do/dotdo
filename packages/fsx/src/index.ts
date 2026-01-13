/**
 * @dotdo/fsx - Pure filesystem logic
 *
 * A POSIX-like filesystem API with zero Cloudflare dependencies.
 * Use this package for the core filesystem types and utilities.
 *
 * For the managed service with DO storage, use `fsx.do` instead.
 *
 * @example
 * ```typescript
 * import { FSx, FsBackend, MemoryBackend } from '@dotdo/fsx'
 *
 * // Use with in-memory backend for testing
 * const backend = new MemoryBackend()
 * const fs = new FSx(backend)
 *
 * await fs.write('/hello.txt', 'Hello, World!')
 * const content = await fs.read('/hello.txt', { encoding: 'utf-8' })
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Core FSx API
// =============================================================================

export { FSx, type FSxOptions } from './fsx.js'

// =============================================================================
// Backend Interface
// =============================================================================

export {
  type FsBackend,
  type BackendWriteResult,
  type BackendReadResult,
  type BackendOptions,
  MemoryBackend,
} from './backend.js'

// =============================================================================
// Types & Classes
// =============================================================================

export {
  // Classes
  Stats,
  Dirent,
  FileHandle,
} from './types.js'

export type {
  // Core capability interface
  FsCapability,

  // FileHandle interface (for type-safe implementations)
  FileHandleLike,

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
} from './types.js'

// =============================================================================
// Constants & Errors
// =============================================================================

export { constants, type Constants } from './constants.js'
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
} from './errors.js'

// =============================================================================
// Configuration
// =============================================================================

export {
  createConfig,
  isReadOnly,
  defaultConfig,
  type FSxConfig,
  type FSxConfigOptions,
} from './config.js'

// =============================================================================
// Path Utilities
// =============================================================================

export * from './path.js'

// =============================================================================
// Unix-like Utilities
// =============================================================================

// Glob pattern matching
export { match, createMatcher, type MatchOptions } from './glob/match.js'
export { glob, GlobTimeoutError, GlobAbortedError, type GlobOptions } from './glob/glob.js'

// Find files
export { find, type FindOptions, type FindResult } from './find/find.js'

// Grep search
export { grep, type GrepOptions, type GrepMatch, type GrepResult } from './grep/grep.js'

// =============================================================================
// Content-Addressable Storage (CAS)
// =============================================================================

export {
  ContentAddressableFS,
  type CASObject,
  type CASStorage,
  type ObjectType,
} from './cas/content-addressable-fs.js'
export { sha1, sha256, bytesToHex, hexToBytes } from './cas/hash.js'
export { hashToPath, pathToHash } from './cas/path-mapping.js'

// =============================================================================
// Sparse Checkout
// =============================================================================

export { parsePattern, type ParsedPattern } from './sparse/patterns.js'
