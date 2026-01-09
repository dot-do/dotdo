/**
 * dotdo/fs - DO with Filesystem Capability
 *
 * Exports a DO class with filesystem operations via $.fs
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/fs'
 *
 * class MyDO extends DO {
 *   async readConfig() {
 *     return this.$.fs.read('/config.json')
 *   }
 * }
 * ```
 */

import { DO as BaseDO } from './objects/DO'
import { withFs } from './lib/mixins/fs'

export const DO = withFs(BaseDO)

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['fs']

export { withFs }
