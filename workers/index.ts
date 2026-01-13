/**
 * Workers Module - Public Exports
 *
 * Unified exports for all worker-related functionality:
 * - Types: Worker types, proxy config, load balancing, messaging
 * - Routing: Namespace resolution, DO binding, request forwarding
 * - Graph: Graph-backed load balancing and worker management
 * - Proxy handlers: API factory, hostname/path routing
 *
 * @module workers
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

// All unified types
export * from './types'

// Explicit type exports for documentation
export type {
  // Proxy configuration
  ProxyMode,
  ProxyConfig,
  HostnameConfig,
  FixedNamespaceConfig,
  BaseProxyConfig,
  APIConfig,
  NamespaceResolveResult,
  SimpleWorkerConfig,

  // Load balancing
  WorkerStatus,
  LoadBalancerStrategy,
  WorkerRegistration,
  WorkerNode,
  TaskRequest,
  RouteResult,
  WorkerLoadMetrics,
  RouteOptions,
  StatusHistoryEntry,
  RoutingHistoryEntry,
  ClusterUtilization,
  LoadBalancer,
  FullLoadBalancer,

  // Worker handlers
  WorkerFetchHandler,
  WorkerHandler,

  // Messaging
  MessageType,
  DeliveryStatus,
  WorkerMessage,
  MessageEnvelope,
  BusConfig,
  MessageFilter,

  // Handoffs
  HandoffReason,
  HandoffState,
  HandoffContext,
  HandoffRequest,
  HandoffResult,
  HandoffChainEntry,

  // Escalations
  EscalationOptions,
  EscalationData,
  EscalationRelationship,
  SLAStatus,

  // Workflow
  WorkflowState,
  WorkflowStepResult,
  AIWorkflowTask,
  WorkerTier,

  // Events
  WorkerEventType,
  WorkerEvent,
} from './types'

// =============================================================================
// ROUTING EXPORTS
// =============================================================================

export {
  // Namespace resolution
  hasSubdomain,
  resolveHostnameNamespace,
  resolvePathNamespace,
  extractPathParams,
  resolveNamespace,
  resolveApiNamespace,

  // DO utilities
  findDOBinding,
  getDOStub,

  // Request forwarding
  getForwardPath,
  createForwardRequest,
  forwardToDO,

  // Error responses
  errorResponse,
  notFoundResponse,
  serviceUnavailableResponse,

  // Handler factories
  createProxyHandler,
  createAPIHandler,
} from './routing'

// =============================================================================
// GRAPH EXPORTS
// =============================================================================

export {
  // Main class
  GraphLoadBalancer,

  // Factory functions
  createGraphRoundRobinBalancer,
  createGraphLeastBusyBalancer,
  createGraphCapabilityBalancer,
} from './graph'

// =============================================================================
// PROXY HANDLER RE-EXPORTS
// =============================================================================

// Re-export from hostname-proxy for backward compatibility
export { createProxyHandler as createHostnameProxyHandler } from './hostname-proxy'
export type { ProxyConfig as HostnameProxyConfig } from './hostname-proxy'

// Re-export from api.ts for backward compatibility
export { API, default as APIDefault } from './api'

// Re-export from simple.ts for backward compatibility
export {
  stripEnvelope,
  createSimpleHandler,
  default as SimpleDefault,
} from './simple'

// =============================================================================
// LOAD BALANCING RE-EXPORTS
// =============================================================================

// Re-export from load-balancing-graph for backward compatibility
export {
  GraphLoadBalancer as LoadBalancingGraph,
  createGraphRoundRobinBalancer as createRoundRobinBalancer,
  createGraphLeastBusyBalancer as createLeastBusyBalancer,
  createGraphCapabilityBalancer as createCapabilityBalancer,
} from './load-balancing-graph'
