/**
 * dotdo/full - DO with All Capabilities
 *
 * Exports a DO class with all available capabilities:
 * - $.fs - Filesystem operations
 * - $.git - Git version control
 * - $.bash - Shell execution
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/full'
 *
 * class MyDO extends DO {
 *   async deploy() {
 *     await this.$.fs.write('/config.json', JSON.stringify(config))
 *     await this.$.git.add('.')
 *     await this.$.git.commit('chore: update config')
 *     await this.$.git.push()
 *     await this.$.bash.run('npm run deploy')
 *   }
 * }
 * ```
 */

import { DO as BaseDO } from './objects/DO'
import { withFs, withGit, withBash } from './lib/mixins'

export const DO = withBash(withGit(withFs(BaseDO)))

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs', 'git', 'bash']

export { withFs, withGit, withBash }
