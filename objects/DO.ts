/**
 * DO - Base Durable Object class
 *
 * This is a re-export from DOFull for backward compatibility.
 * The DO class hierarchy is:
 *
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
 * For tree-shakeable imports:
 * - `import { DO } from 'dotdo/tiny'` - DOTiny (minimal)
 * - `import { DO } from 'dotdo/base'` - DOBase (workflow context only)
 * - `import { DO } from 'dotdo/full'` - DOFull (all features)
 * - `import { DO } from 'dotdo'`      - DOFull + fs/git/bash mixins
 *
 * @example
 * ```typescript
 * import { DO } from './DO'
 *
 * class MyDO extends DO {
 *   async onStart() {
 *     this.$.on.Customer.created(async (event) => {
 *       console.log('Customer created:', event)
 *     })
 *   }
 * }
 * ```
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
} from './DOBase'

// Import DO to use as default export
import { DO as DOClass } from './DOFull'
export default DOClass
