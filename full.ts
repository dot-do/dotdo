/**
 * dotdo/full - DO with All Capabilities
 *
 * Exports a DO class with all available capabilities:
 * - $.fs - Filesystem operations
 * - $.git - Git version control
 * - $.bash - Shell execution
 *
 * Note: The bash capability uses a stub executor by default.
 * Override by providing a custom executor in your subclass.
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
import { withFs, withGit, withBash, type BashExecutor } from './lib/mixins'

/**
 * Stub executor that throws when used.
 * Users should configure a real executor via environment bindings.
 */
const stubExecutor: BashExecutor = {
  async execute(command: string, args?: string[]) {
    throw new Error(
      `Bash execution not configured. ` +
      `Attempted to run: ${command} ${args?.join(' ') ?? ''}\n` +
      `Configure a real executor (e.g., Cloudflare Container, RPC) in your DO class.`
    )
  }
}

const DOWithFsGit = withGit(withFs(BaseDO))

export const DO = withBash(DOWithFsGit, {
  executor: () => stubExecutor
})

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs', 'git', 'bash']

export { withFs, withGit, withBash }
