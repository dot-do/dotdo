/**
 * @module objects/core
 * @description Composition-based modules for Durable Objects
 *
 * This module exports composable building blocks that can be used
 * to construct DO classes without deep inheritance hierarchies.
 *
 * **Modules:**
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
