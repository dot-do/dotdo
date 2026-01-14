/**
 * Capabilities for Durable Objects
 *
 * Capabilities extend the base DO class with additional features on the $ workflow context.
 * They can be composed to build DOs with the exact capabilities needed.
 *
 * Example:
 * ```typescript
 * class MyDO extends withGit(withFs(DO)) {
 *   async deploy() {
 *     await this.$.fs.write('/config.json', JSON.stringify(config))
 *     await this.$.git.add('.')
 *     await this.$.git.commit('chore: update config')
 *     await this.$.git.push()
 *   }
 * }
 * ```
 *
 * Dependency Chain:
 * - withFs: Base filesystem capability (no dependencies)
 * - withGit: Git operations (requires withFs)
 * - withBash: Shell execution (requires withFs)
 * - withNpm: Package management (requires withFs, optionally withBash for scripts)
 */

export { withFs, type FsCapability, type WithFsContext } from './fs'
export {
  withGit,
  GitModule,
  createGitModule,
  type GitCapability,
  type GitModuleOptions,
  type WithGitContext,
  type WithGitDO,
  type GitBinding,
  type GitStatus,
  type GitCommitResult,
  type GitLogEntry,
  type SyncResult,
  type PushResult,
  type StashEntry,
  type StashResult,
} from './git'
export {
  withBash,
  BashModule,
  type BashCapability,
  type BashExecutor,
  type BashResult,
  type ExecOptions,
  type SpawnOptions,
  type SpawnHandle,
  type WithBashContext,
  type WithBashConfig,
} from './bash'
export {
  withNpm,
  NpmModule,
  type NpmCapability,
  type WithNpmContext,
  type WithNpmBashContext,
  type WithNpmOptions,
  type InstallResult,
  type InstalledPackage,
  type PackageJson,
} from './npm'
export { type Constructor } from './types'
