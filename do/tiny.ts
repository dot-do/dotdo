/**
 * dotdo/tiny - Minimal DO Entry Point
 *
 * Exports the tiniest possible DO class (~15KB) with only:
 * - Identity (ns, $type)
 * - Database (Drizzle/SQLite)
 * - fetch() + /health
 * - initialize()
 * - toJSON()
 *
 * Use this when you want the smallest possible bundle size
 * and don't need WorkflowContext, event handlers, stores, or scheduling.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/tiny'
 *
 * class MyDO extends DO {
 *   // Only core methods available - no $, stores, or lifecycle
 *   async fetch(request: Request): Promise<Response> {
 *     // Custom routing
 *   }
 * }
 * ```
 */

export { DO, type Env } from '../objects/core/DOTiny.js'

/**
 * Capabilities included in this entry point
 */
export const capabilities: string[] = []
