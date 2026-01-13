/**
 * dotdo/base - Core DO with WorkflowContext
 *
 * Exports the middle-tier DO class (~80KB) with:
 * - WorkflowContext ($)
 * - Event handlers ($.on.Noun.verb)
 * - Stores (things, rels, actions, events, search, objects, dlq)
 * - Scheduling ($.every)
 * - Actor context
 * - AI functions ($.ai, $.write, $.list, etc.)
 *
 * Does NOT include (see dotdo/full for these):
 * - Lifecycle operations (fork, clone, compact, move)
 * - Sharding (shard, unshard, routing)
 * - Branching (branch, checkout, merge)
 * - Promotion (promote, demote)
 * - $.fs, $.git, $.bash mixins
 *
 * Use this when you need workflow capabilities but not lifecycle management.
 *
 * @example
 * ```typescript
 * import { DO } from 'dotdo/base'
 *
 * class MyDO extends DO {
 *   async onStart() {
 *     // WorkflowContext available
 *     this.$.on.Customer.created(async (event) => {
 *       console.log('Customer created:', event)
 *     })
 *
 *     this.$.every.hour(async () => {
 *       // Hourly task
 *     })
 *   }
 *
 *   async summarize(text: string) {
 *     return this.$.summarize`${text}`
 *   }
 * }
 * ```
 */

export { DO, type Env, type ThingsCollection, type RelationshipsAccessor, type RelationshipRecord } from '../objects/DOBase.js'

/**
 * Capabilities included in this entry point
 */
export const capabilities = ['workflow', 'stores', 'events', 'scheduling', 'ai']
