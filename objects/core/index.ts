/**
 * @module objects/core
 * @description Core Durable Object classes and composition-based modules
 *
 * This module exports:
 *
 * **DO Base Classes (inheritance hierarchy):**
 * - DOTiny (~15KB): Minimal DO with identity, db, fetch
 * - DOBase (~80KB): + WorkflowContext, stores, events, scheduling
 * - DOFull (~120KB): + Lifecycle, sharding, branching, promotion
 * - DO: Re-exports DOFull for backward compatibility
 *
 * **Composable Modules:**
 * - Identity: Namespace, branch, and type identity management
 * - StorageManager: Lazy-loaded data store accessors
 * - WorkflowContext: Event handlers, scheduling, and execution modes
 * - Resolver: Cross-DO resolution with circuit breakers
 * - Router: HTTP routing with Hono
 */

// Identity management
export {
  Identity,
  createIdentity,
  type IIdentity,
  type IdentityConfig,
} from './Identity'

// Storage management
export {
  StorageManager,
  createStorageManager,
  type IStorageManager,
  type StorageManagerDeps,
} from './StorageManager'

// Workflow context
export {
  WorkflowContextManager,
  createWorkflowContextManager,
  type WorkflowContextDeps,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TRY_TIMEOUT,
} from './WorkflowContext'

// Cross-DO resolution
export {
  Resolver,
  createResolver,
  CrossDOError,
  type ResolverConfig,
  type ResolverDeps,
} from './Resolver'

// HTTP routing
export {
  Router,
  createRouter,
  extractUserFromRequest,
  type IRouter,
  type RouterDeps,
} from './Router'

// ============================================================================
// DO BASE CLASSES
// ============================================================================

// DOTiny - Minimal Durable Object (~15KB)
export {
  DO as DOTiny,
  extractUserFromRequest as extractUserFromRequestTiny,
  type Env as TinyEnv,
  type UserContext,
} from './DOTiny'

// DOBase - WorkflowContext and stores (~80KB)
// Note: CrossDOError is exported from DOBase but also from Resolver above
export {
  DO as DOBase,
  CrossDOError as DOBaseCrossDOError, // Aliased to avoid duplicate export
  type Env as BaseEnv,
  type IcebergOptions,
  type ThingsCollection,
  type RelationshipsAccessor,
  type RelationshipRecord,
  type KeyResult,
  type OKR,
  type OKRDefinition,
} from './DOBase'

// DOFull - Full lifecycle operations (~120KB)
export {
  DO as DOFull,
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

// DO - Re-export DOFull as default DO class for backward compatibility
export { DO, default as DODefault } from './DO'
