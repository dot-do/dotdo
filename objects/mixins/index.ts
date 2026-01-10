/**
 * Capability Mixins for Durable Objects
 *
 * This module exports all capability mixins that can be composed
 * with Durable Object classes to add optional features.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo'
 * import { withFs, withGit, withBash } from 'dotdo/mixins'
 *
 * // Compose capabilities
 * class MyDO extends withBash(withGit(withFs(DO))) {
 *   async handleRequest(req: Request) {
 *     // Access all capabilities via $
 *     await this.$.fs.write('/file.txt', 'Hello')
 *     await this.$.git.commit('Add file')
 *     await this.$.bash.exec('echo "Done"')
 *   }
 * }
 * ```
 */

// Infrastructure for creating custom mixins
export {
  createCapabilityMixin,
  type Constructor,
  type CapabilityContext,
  type CapabilityInit,
  type CapabilityMixin,
} from './infrastructure'

// Filesystem capability
export {
  withFs,
  type WithFsOptions,
  type WithFsContext,
  type FsCapability,
  FsModule,
} from './fs'

// NPM package management capability
export {
  withNpm,
  type WithNpmOptions,
  type WithNpmContext,
  type NpmCapability,
  type BashResult,
  type LockFile,
  type LockFileEntry,
  type InstallResult,
  type InstalledPackage,
  type PackageJson,
  type ResolvedPackage,
} from './npm'
