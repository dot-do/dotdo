/**
 * withFs Capability - Filesystem Capability for Durable Objects
 *
 * This module re-exports the filesystem capability from lib/capabilities/fs.ts
 * which provides a self-contained implementation using DurableObjectStorage.
 *
 * The implementation only imports types from @dotdo/fsx (the core package),
 * avoiding circular dependencies with fsx.do (the managed service).
 *
 * Architecture:
 * - @dotdo/fsx: Core filesystem logic (pure, zero deps)
 * - dotdo: Uses @dotdo/fsx core (this package)
 * - fsx.do: Managed service that uses dotdo
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withFs } from 'dotdo/capabilities'
 *
 * class MySite extends withFs(DO) {
 *   async loadContent() {
 *     const content = await this.$.fs.read('/content/index.mdx')
 *     const files = await this.$.fs.list('/content')
 *     return { content, files }
 *   }
 * }
 * ```
 *
 * @module objects/capabilities/fs
 */

// Re-export everything from lib/capabilities/fs which has the correct implementation
export {
  // Capability function
  withFs,
  // Classes
  FsModule,
  FsError,
  // Types
  type FsCapability,
  type FsEntry,
  type FsStat,
  type FsReadOptions,
  type FsWriteOptions,
  type FsListOptions,
  type FsMkdirOptions,
  type FsModuleOptions,
  type FsErrorCode,
  type WithFsContext,
  type WithFsDO,
  // Re-exported @dotdo/fsx types
  type FsxReadOptions,
  type FsxWriteOptions,
  type FsxMkdirOptions,
  type FsxStats,
  type FsxDirent,
  type StorageTier,
  type FsxCapability,
} from '../../lib/capabilities/fs'

// Note: WithFsOptions was previously exported but is not in the lib implementation.
// The lib/capabilities/fs.ts withFs function doesn't take options - it uses DurableObjectStorage directly.
// If options are needed, they should be added to lib/capabilities/fs.ts.
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
