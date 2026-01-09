/**
 * dotdo/bash - DO with Bash Capability
 *
 * Exports a DO class with filesystem and shell operations via $.fs and $.bash
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/bash'
 *
 * class MyDO extends DO {
 *   async runTests() {
 *     const result = await this.$.bash.exec('npm test')
 *     if (result.exitCode !== 0) {
 *       throw new Error(`Tests failed: ${result.stderr}`)
 *     }
 *     return result.stdout
 *   }
 * }
 * ```
 */

import { DO as BaseDO } from './objects/DO'
import { withFs } from './objects/mixins/fs'
import { withBash } from './objects/mixins/bash'

export const DO = withBash(withFs(BaseDO))

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs', 'bash']

export { withFs, withBash }
