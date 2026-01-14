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
 * - $.bash - Shell execution (via bashx with Cloudflare Containers)
 *
 * The bash capability automatically uses CloudflareContainerExecutor when
 * env.BASH_CONTAINER is configured, enabling real shell execution in a
 * sandboxed Linux environment.
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
 *
 * @example Configure BASH_CONTAINER in wrangler.toml
 * ```toml
 * [[containers]]
 * binding = "BASH_CONTAINER"
 * image = "ghcr.io/dot-do/bashx-container:latest"
 * ```
 */

import { DO as BaseDO } from '../objects/DOFull.js'
import {
  withFs,
  withGit,
  withBash,
  CloudflareContainerExecutor,
  type BashExecutor,
  type BashResult,
  type ExecOptions,
} from '../lib/capabilities/index.js'

/**
 * Fallback executor that throws when used.
 * Only used when env.BASH_CONTAINER is not configured.
 */
function createFallbackExecutor(command: string): never {
  throw new Error(
    `Bash execution not configured. ` +
    `Attempted to run: ${command}\n\n` +
    `To enable bash execution, configure BASH_CONTAINER in wrangler.toml:\n` +
    `  [[containers]]\n` +
    `  binding = "BASH_CONTAINER"\n` +
    `  image = "ghcr.io/dot-do/bashx-container:latest"\n\n` +
    `Or provide a custom executor in your DO subclass.`
  )
}

const DOWithFsGit = withGit(withFs(BaseDO))

export const DO = withBash(DOWithFsGit, {
  /**
   * Executor factory that uses CloudflareContainerExecutor when available.
   * Falls back to an error-throwing executor if BASH_CONTAINER is not configured.
   */
  executor: (instance): BashExecutor => {
    // Check if BASH_CONTAINER binding is available
    const containerBinding = (instance as any).env?.BASH_CONTAINER

    if (containerBinding) {
      // Use the real CloudflareContainerExecutor from bashx
      return new CloudflareContainerExecutor({
        containerBinding,
      })
    }

    // Return a fallback executor that throws with helpful instructions
    return {
      async execute(command: string, options?: ExecOptions): Promise<BashResult> {
        createFallbackExecutor(command)
      },
    }
  },

  /**
   * Wire up $.fs for native file operations (cat, ls, head, tail).
   * These use FsCapability directly instead of spawning a container.
   */
  fs: (instance) => (instance as any).$.fs,

  /**
   * Enable native file operations when FsCapability is available.
   */
  useNativeOps: true,
})

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs', 'git', 'bash']

export { withFs, withGit, withBash, CloudflareContainerExecutor }
