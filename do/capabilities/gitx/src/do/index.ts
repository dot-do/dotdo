/**
 * @fileoverview gitx.do/do Entry Point
 *
 * This is the entry point for integrating gitx with dotdo's Durable Objects.
 * It exports the GitModule class and related utilities for use in DOs.
 *
 * @module gitx.do/do
 *
 * @example
 * ```typescript
 * // Import for DO integration
 * import { GitModule, createGitModule, withGit } from 'gitx.do/do'
 *
 * // Create a GitModule in your DO
 * class MyDO extends DO {
 *   git = new GitModule({
 *     repo: 'org/repo',
 *     branch: 'main',
 *     r2: this.env.R2_BUCKET
 *   })
 *
 *   async syncRepository() {
 *     await this.git.sync()
 *   }
 * }
 *
 * // Or use the withGit mixin
 * class MyDO extends withGit(DO, { repo: 'org/repo' }) {
 *   // this.git is automatically available
 * }
 * ```
 */

// ============================================================================
// GitModule Imports and Exports
// ============================================================================

import {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
} from './GitModule'

export {
  GitModule,
  createGitModule,
  isGitModule,
  type GitModuleOptions,
  type GitBinding,
  type GitStatus,
  type SyncResult,
  type PushResult,
  type FsCapability,
  type R2BucketLike,
  type R2ObjectLike,
  type R2ObjectsLike,
}

// ============================================================================
// withGit Mixin Imports and Exports
// ============================================================================

import {
  withGit,
  hasGitCapability,
  type WithGitCapability,
  type WithGitOptions,
  type WithGitContext,
  type Constructor,
} from './withGit'

export {
  withGit,
  hasGitCapability,
  type WithGitCapability,
  type WithGitOptions,
  type WithGitContext,
  type Constructor,
}

// ============================================================================
// withFs Mixin Imports and Exports
// ============================================================================

import {
  withFs,
  hasFsCapability,
  type WithFsCapability,
  type WithFsOptions,
  type WithFsContext,
} from './withFs'

export {
  withFs,
  hasFsCapability,
  type WithFsCapability,
  type WithFsOptions,
  type WithFsContext,
}

// ============================================================================
// FsModule Imports and Exports
// ============================================================================

import {
  FsModule,
  createFsModule,
  isFsModule,
  // Constants
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFLNK,
  // Error classes
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  ENOTEMPTY,
  // Types
  type FsModuleOptions,
  type SqlStorage,
  type SqlResult,
  type R2BucketLike as FsR2BucketLike,
  type R2ObjectLike as FsR2ObjectLike,
  type ReadOptions,
  type WriteOptions,
  type MkdirOptions,
  type RmdirOptions,
  type RemoveOptions,
  type ReaddirOptions,
  type MoveOptions,
  type CopyOptions,
  type Dirent,
  type Stats,
} from './FsModule'

export {
  FsModule,
  createFsModule,
  isFsModule,
  // Constants
  S_IFMT,
  S_IFREG,
  S_IFDIR,
  S_IFLNK,
  // Error classes
  ENOENT,
  EEXIST,
  EISDIR,
  ENOTDIR,
  ENOTEMPTY,
  // Types
  type FsModuleOptions,
  type SqlStorage,
  type SqlResult,
  type FsR2BucketLike,
  type FsR2ObjectLike,
  type ReadOptions,
  type WriteOptions,
  type MkdirOptions,
  type RmdirOptions,
  type RemoveOptions,
  type ReaddirOptions,
  type MoveOptions,
  type CopyOptions,
  type Dirent,
  type Stats,
}

// ============================================================================
// Container Executor Imports and Exports
// ============================================================================

import {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSandboxExecutor,
  createHttpExecutor,
  createWebSocketExecutor,
  isContainerExecutor,
  type ContainerExecutorOptions,
  type CloudflareSandbox,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxStreamResult,
  type SandboxStreamChunk,
  type SandboxProcessHandle,
  type CloudflareContainer,
  type CloudflareContainerInstance,
  type ContainerStartOptions,
  // Executor types (compatible with bashx.do)
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
} from './container-executor'

export {
  CloudflareContainerExecutor,
  createContainerExecutor,
  createSandboxExecutor,
  createHttpExecutor,
  createWebSocketExecutor,
  isContainerExecutor,
  type ContainerExecutorOptions,
  type CloudflareSandbox,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxStreamResult,
  type SandboxStreamChunk,
  type SandboxProcessHandle,
  type CloudflareContainer,
  type CloudflareContainerInstance,
  type ContainerStartOptions,
  // Executor types (compatible with bashx.do)
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type BashExecutor,
}

// ============================================================================
// TieredStorage Imports and Exports
// ============================================================================

import {
  TieredStorage,
  createTieredStorage,
  type TieredStorageOptions,
  type TieredStorageStats,
  type GetObjectResult,
  type ObjectMetadata,
  type StorageTier,
  type R2BucketLike as TieredR2BucketLike,
  type R2ObjectLike as TieredR2ObjectLike,
  type R2ObjectsLike as TieredR2ObjectsLike,
  type R2PutOptions,
  type SqlStorage as TieredSqlStorage,
} from './tiered-storage'

export {
  TieredStorage,
  createTieredStorage,
  type TieredStorageOptions,
  type TieredStorageStats,
  type GetObjectResult,
  type ObjectMetadata,
  type StorageTier,
  type TieredR2BucketLike,
  type TieredR2ObjectLike,
  type TieredR2ObjectsLike,
  type R2PutOptions,
  type TieredSqlStorage,
}

// ============================================================================
// GitRepoDO Imports and Exports
// ============================================================================

import { GitRepoDO, isGitRepoDO } from './GitRepoDO'

export { GitRepoDO, isGitRepoDO }

// ============================================================================
// Schema and Database Imports and Exports
// ============================================================================

import {
  SchemaManager,
  SCHEMA_VERSION,
  SCHEMA_SQL,
  type DurableObjectStorage,
} from './schema'

export {
  SchemaManager,
  SCHEMA_VERSION,
  SCHEMA_SQL,
  type DurableObjectStorage,
}

// ============================================================================
// ObjectStore Imports and Exports
// ============================================================================

import {
  ObjectStore,
  type StoredObject,
  type ObjectStoreOptions,
  type ObjectStoreLogger,
  type ObjectStoreMetrics,
} from './object-store'

export {
  ObjectStore,
  type StoredObject,
  type ObjectStoreOptions,
  type ObjectStoreLogger,
  type ObjectStoreMetrics,
}

// ============================================================================
// WAL (Write-Ahead Log) Imports and Exports
// ============================================================================

import {
  WALManager,
  type WALOperationType,
  type TransactionState,
  type WALEntry,
  type Transaction,
  type Checkpoint,
} from './wal'

export {
  WALManager,
  type WALOperationType,
  type TransactionState,
  type WALEntry,
  type Transaction,
  type Checkpoint,
}
