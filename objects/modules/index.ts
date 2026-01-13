/**
 * DOBase Module System
 *
 * This package exports the modular components extracted from DOBase:
 * - DOStorage - SQLite, stores, persistence
 * - DOTransport - REST, MCP, CapnWeb handlers
 * - DOWorkflow - $ context, events, scheduling
 * - DOIntrospection - Schema discovery
 *
 * These modules can be used independently or composed together
 * to build custom Durable Objects with selective functionality.
 *
 * @module objects/modules
 */

// Storage Module
export { DOStorage, type StoreContext, type DOFeatureConfig, type StorageInterface, type StorageEnv } from './DOStorage'

// Transport Module
export { DOTransport, type TransportContext, type AuthContext } from './DOTransport'

// Workflow Module
export { DOWorkflow, type WorkflowContext, type WorkflowContextInput, DEFAULT_RETRY_POLICY, DEFAULT_TRY_TIMEOUT } from './DOWorkflow'

// Introspection Module
export { DOIntrospection, type IntrospectContext, type DOSchema, type VisibilityRole } from './DOIntrospection'

// Legacy modules (previously extracted)
export { StoresModule, type EventHandlerMap } from './StoresModule'
export { LocationModule, type LocationStorage, type LocationDetectedHook } from './LocationModule'

// Phase 1 - Low-Hanging Fruit (DOBase decomposition)
export { ActorContextModule, type ActorContext } from './ActorContextModule'
export { VisibilityModule, type Visibility, type VisibleThing, type ThingGetter } from './VisibilityModule'
