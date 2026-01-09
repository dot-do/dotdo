/**
 * Capability Mixins for Durable Objects
 *
 * Mixins extend the base DO class with additional capabilities on the $ workflow context.
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
 */

export { withFs, type FsCapability, type WithFsContext } from './fs'
export { withGit, type GitCapability, type WithGitContext } from './git'
export { withBash, type BashCapability, type WithBashContext } from './bash'
