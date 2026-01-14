/**
 * bashx Safety Module
 *
 * Exports safety analysis utilities for command validation.
 *
 * @example
 * ```typescript
 * import { analyze, isDangerous, classifyCommand } from 'bashx/safety'
 * import { parse } from 'bashx/ast'
 *
 * const ast = parse('rm -rf /')
 * const { dangerous, reason } = isDangerous(ast)
 * if (dangerous) {
 *   console.warn('Dangerous command:', reason)
 * }
 * ```
 *
 * @module bashx/safety
 */

export { analyze, isDangerous, classifyCommand } from '../ast/analyze.js'
export type { SafetyClassification, Intent, CommandClassification } from '../types.js'
