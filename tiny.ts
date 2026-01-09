/**
 * dotdo/tiny - Minimal DO Entry Point
 *
 * Exports the base DO class with no additional capabilities.
 * Use this when you want the smallest possible bundle size.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/tiny'
 *
 * class MyDO extends DO {
 *   // No $.fs, $.git, or $.bash available
 * }
 * ```
 */

export { DO } from './objects/DO'

/**
 * Capabilities included in this entry point
 */
export const capabilities: string[] = []
