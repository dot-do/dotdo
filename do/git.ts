/**
 * dotdo/git - DO with Git Capability
 *
 * Exports a DO class with filesystem and git operations via $.fs and $.git
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/git'
 *
 * class MyDO extends DO {
 *   async commitChanges() {
 *     await this.$.git.add('.')
 *     await this.$.git.commit('feat: add feature')
 *     await this.$.git.push()
 *   }
 * }
 * ```
 */

import { DO as BaseDO } from '../objects/core/DO.js'
import { withFs } from '../lib/capabilities/fs.js'
import { withGit } from '../lib/capabilities/git.js'

export const DO = withGit(withFs(BaseDO))

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs', 'git']

export { withFs, withGit }
