/**
 * dotdo/full - DO with All Capabilities
 *
 * Exports a DO class (~120KB) with all available capabilities:
 * - WorkflowContext ($) with event handlers, scheduling
 * - Stores (things, rels, actions, events, search, objects, dlq)
 * - Lifecycle (fork, clone, compact, move)
 * - Sharding (shard, unshard, routing)
 * - Branching (branch, checkout, merge)
 * - Promotion (promote, demote)
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
 *
 *   async backup() {
 *     // Full lifecycle operations available
 *     await this.clone('https://backup.example.com.ai')
 *     await this.branch('feature-x')
 *   }
 * }
 * ```
 */

import { DO as BaseDO } from '../objects/DOFull'
import { withFs, withGit, withBash, type BashExecutor, type BashResult, type ExecOptions } from '../lib/mixins'

/**
 * Stub executor that throws when used.
 * Users should configure a real executor via environment bindings.
 */
const stubExecutor: BashExecutor = {
  async execute(command: string, options?: ExecOptions): Promise<BashResult> {
    throw new Error(
      `Bash execution not configured. ` +
      `Attempted to run: ${command}\n` +
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
