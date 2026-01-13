/**
 * @module DO
 * @description Core Durable Object - Main entry point for the DO class hierarchy
 *
 * This module re-exports from DOFull for backward compatibility and serves as
 * the primary entry point for applications using the dotdo framework. The DO
 * class provides a full-featured Durable Object implementation with:
 *
 * **Core Capabilities:**
 * - WorkflowContext (`$`) for event handling and scheduling
 * - Graph-based data stores (things, relationships, actions, events)
 * - Full-text and semantic search
 * - Cross-DO communication with circuit breakers
 * - Lifecycle operations (fork, clone, compact, move)
 * - Branching and version control (branch, checkout, merge)
 * - Horizontal scaling via sharding
 *
 * **DO Class Hierarchy:**
 * ```
 * DOTiny (~15KB)        - Identity, db, fetch, toJSON
 *    |
 *    v
 * DOBase (~80KB)        - + WorkflowContext, stores, events, scheduling
 *    |
 *    v
 * DOFull (~120KB)       - + Lifecycle, sharding, branching, promotion
 * ```
 *
 * **Tree-shakeable Imports:**
 * - `import { DO } from 'dotdo/tiny'` - DOTiny (minimal ~15KB)
 * - `import { DO } from 'dotdo/base'` - DOBase (workflow context ~80KB)
 * - `import { DO } from 'dotdo/full'` - DOFull (all features ~120KB)
 * - `import { DO } from 'dotdo'` - DOFull + fs/git/bash mixins
 *
 * @example Basic Usage with Event Handlers
 * ```typescript
 * import { DO } from 'dotdo'
 *
 * class CustomerService extends DO {
 *   async onStart() {
 *     // Register event handlers using WorkflowContext
 *     this.$.on.Customer.created(async (event) => {
 *       console.log('Customer created:', event.data)
 *       await this.$.send({ type: 'welcome.email', to: event.data.email })
 *     })
 *
 *     // Schedule recurring tasks
 *     this.$.every.day.at('9am')(async () => {
 *       await this.sendDailyReport()
 *     })
 *   }
 * }
 * ```
 *
 * @example Using Graph Stores
 * ```typescript
 * import { DO } from 'dotdo'
 *
 * class OrderService extends DO {
 *   async createOrder(customerId: string, items: Item[]) {
 *     // Create a Thing in the graph
 *     const order = await this.things.create({
 *       $type: 'Order',
 *       name: `Order for ${customerId}`,
 *       data: { customerId, items, status: 'pending' }
 *     })
 *
 *     // Create relationship
 *     await this.rels.create({
 *       verb: 'placedBy',
 *       from: order.$id,
 *       to: `Customer/${customerId}`
 *     })
 *
 *     return order
 *   }
 * }
 * ```
 *
 * @example Lifecycle Operations
 * ```typescript
 * import { DO } from 'dotdo'
 *
 * class StatefulService extends DO {
 *   async backup() {
 *     // Clone state to another DO
 *     await this.clone('https://backup.example.com')
 *   }
 *
 *   async createFeatureBranch(name: string) {
 *     // Create a branch for isolated changes
 *     await this.branch(name)
 *     await this.checkout(name)
 *   }
 * }
 * ```
 *
 * @see DOTiny - Minimal implementation (~15KB)
 * @see DOBase - WorkflowContext and stores (~80KB)
 * @see DOFull - Lifecycle operations (~120KB)
 */

// Re-export everything from DOFull for backward compatibility
export {
  DO,
  type Env,
  type PromoteResult,
  type DemoteResult,
  type CloneResult,
  type BranchResult,
  type CheckoutResult,
  type MergeResult,
  type StagingData,
  type StagedPrepareResult,
  type Checkpoint,
  type ParticipantAck,
  type TransactionAuditLog,
  type ParticipantStateHistory,
  type CloneMode,
  type CloneOptions,
  type CloneStatus,
  type ConflictResolution,
  type EventualCloneState,
  type SyncStatus,
  type SyncResult,
  type ConflictInfo,
  type EventualCloneHandle,
  type ResumableCloneStatus,
  type ResumableCloneState,
  type ResumableCheckpoint,
  type ResumableCloneOptions,
  type CloneLockState,
  type CloneLockInfo,
  type ResumableCloneHandle,
} from './DOFull'

// Also re-export common types from DOBase for consumers who need them
export type {
  ThingsCollection,
  RelationshipsAccessor,
  RelationshipRecord,
  // OKR types
  KeyResult,
  OKR,
  OKRDefinition,
} from './DOBase'

// Import DO to use as default export
import { DO as DOClass } from './DOFull'
export default DOClass
