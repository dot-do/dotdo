/**
 * Unified Worker Types
 *
 * Consolidated type definitions for all worker-related functionality:
 * - Proxy worker types (hostname, path, API routing)
 * - Load balancing types (worker registration, routing, metrics)
 * - Graph-backed worker node types
 *
 * @module workers/types
 */

import type { CloudflareEnv } from '../types/CloudflareBindings'

// =============================================================================
// PROXY CONFIGURATION TYPES
// =============================================================================

/**
 * Namespace resolution mode for proxy workers
 */
export type ProxyMode = 'hostname' | 'path' | 'fixed'

/**
 * Configuration for hostname-based proxy routing
 */
export interface HostnameConfig {
  /** Number of subdomain levels to use as namespace (default: 1) */
  stripLevels?: number
  /** Root domain to match against (e.g., 'api.dotdo.dev') */
  rootDomain: string
}

/**
 * Configuration for fixed namespace routing
 */
export interface FixedNamespaceConfig {
  /** The namespace to always route to */
  namespace: string
}

/**
 * Base proxy configuration shared across proxy types
 */
export interface BaseProxyConfig {
  /** Namespace resolution mode */
  mode: ProxyMode
  /** Path prefix to strip before forwarding (e.g., '/api/v1') */
  basepath?: string
  /** Fallback namespace when resolution fails */
  defaultNs?: string
}

/**
 * Full proxy configuration with mode-specific options
 */
export interface ProxyConfig extends BaseProxyConfig {
  /** Hostname mode configuration */
  hostname?: HostnameConfig
  /** Fixed mode configuration */
  fixed?: FixedNamespaceConfig
}

/**
 * API factory configuration
 *
 * @example
 * ```typescript
 * // Hostname-based: tenant.api.dotdo.dev -> DO('tenant')
 * API()
 *
 * // Path param: api.dotdo.dev/acme/users -> DO('acme')
 * API({ ns: '/:org' })
 *
 * // Fixed namespace: api.dotdo.dev/path -> DO('main')
 * API({ ns: 'main' })
 * ```
 */
export interface APIConfig {
  /**
   * Namespace pattern for routing:
   * - undefined: hostname-based (subdomain extraction)
   * - '/:param': single path param (Express-style)
   * - '/:param1/:param2': nested path params (joined by colon)
   * - 'literal': fixed namespace (no colon prefix)
   */
  ns?: string
}

/**
 * Result of namespace resolution
 */
export interface NamespaceResolveResult {
  /**
   * The resolved namespace - either a full URL or a literal string.
   * - Hostname mode: 'https://tenant.api.example.org.ai'
   * - Path param mode: 'https://api.example.org.ai/acme'
   * - Fixed namespace mode: 'main' (literal)
   */
  ns: string | null
  /** Remaining path after namespace extraction */
  remainingPath: string
}

// =============================================================================
// SIMPLE WORKER TYPES
// =============================================================================

/**
 * Configuration for simple JSON workers that strip HATEOAS envelope
 */
export interface SimpleWorkerConfig {
  /** Routing mode (defaults to 'path') */
  mode?: ProxyMode
  /** Root domain for hostname mode */
  rootDomain?: string
  /** Fixed namespace for fixed mode */
  namespace?: string
  /** Base path to strip */
  basepath?: string
  /** Default namespace fallback */
  defaultNs?: string
}

// =============================================================================
// LOAD BALANCING TYPES
// =============================================================================

/**
 * Worker availability status
 */
export type WorkerStatus = 'available' | 'busy' | 'offline'

/**
 * Load balancing strategy
 */
export type LoadBalancerStrategy = 'round-robin' | 'least-busy' | 'capability' | 'weighted'

/**
 * Worker registration options
 */
export interface WorkerRegistration {
  /** Unique worker identifier */
  id: string
  /** Worker endpoint URL */
  endpoint: string
  /** Supported capabilities */
  capabilities?: string[]
  /** Maximum concurrent tasks */
  maxConcurrentTasks?: number
  /** Initial weight for weighted load balancing */
  weight?: number
}

/**
 * Worker node representation (graph node or in-memory)
 */
export interface WorkerNode {
  id: string
  endpoint: string
  status: WorkerStatus
  capabilities: string[]
  currentTasks: number
  maxConcurrentTasks: number
  cpuUsage: number
  memoryUsage: number
  weight: number
  registeredAt: number
  lastHeartbeat: number
}

/**
 * Task request to be routed
 */
export interface TaskRequest {
  /** Unique task identifier */
  id: string
  /** Task type */
  type: string
  /** Required capabilities for execution */
  requiredCapabilities?: string[]
  /** Preferred capabilities (not required) */
  preferredCapabilities?: string[]
  /** Task priority */
  priority?: number
}

/**
 * Result of routing a task to a worker
 */
export interface RouteResult {
  /** Selected worker ID (null if no worker available) */
  workerId: string | null
  /** Worker endpoint URL */
  endpoint: string | null
  /** Strategy used for routing */
  strategy: LoadBalancerStrategy
  /** Routing timestamp */
  timestamp: number
}

/**
 * Worker load metrics for load balancing decisions
 */
export interface WorkerLoadMetrics {
  currentTasks?: number
  cpuUsage?: number
  memoryUsage?: number
}

/**
 * Routing options for load balancing
 */
export interface RouteOptions {
  /** Tiebreaker metric for least-busy */
  tiebreaker?: 'cpuUsage' | 'memoryUsage' | 'currentTasks'
}

/**
 * Status history entry for tracking worker state changes
 */
export interface StatusHistoryEntry {
  status: WorkerStatus
  timestamp: number
}

/**
 * Routing history entry for observability
 */
export interface RoutingHistoryEntry {
  taskId: string
  routedAt: number
  completedAt?: number
  strategy: LoadBalancerStrategy
}

/**
 * Cluster utilization metrics
 */
export interface ClusterUtilization {
  avgCpuUsage: number
  avgMemoryUsage: number
  totalTasks: number
  workerCount: number
}

// =============================================================================
// LOAD BALANCER INTERFACE
// =============================================================================

/**
 * Simple load balancer interface for routing tasks
 */
export interface LoadBalancer {
  route(task: TaskRequest): Promise<RouteResult>
}

/**
 * Full load balancer interface with worker management
 */
export interface FullLoadBalancer extends LoadBalancer {
  registerWorker(registration: WorkerRegistration): Promise<WorkerNode>
  deregisterWorker(workerId: string): Promise<void>
  updateWorkerStatus(workerId: string, status: WorkerStatus): Promise<void>
  updateWorkerLoad(workerId: string, metrics: WorkerLoadMetrics): Promise<void>
  getAvailableWorkers(): Promise<WorkerNode[]>
  completeTask(taskId: string, workerId: string): Promise<void>
  getRoutingHistory(workerId: string): Promise<RoutingHistoryEntry[]>
  getStatusHistory(workerId: string): Promise<StatusHistoryEntry[]>
  heartbeat(workerId: string): Promise<void>
  setHeartbeatTimeout(timeout: number): void
  checkHeartbeats(): Promise<void>
  getTaskDistribution(): Promise<Record<string, number>>
  getClusterUtilization(): Promise<ClusterUtilization>
  identifyHotspots(threshold?: number): Promise<string[]>
}

// =============================================================================
// WORKER HANDLER TYPES
// =============================================================================

/**
 * Worker fetch handler type
 */
export type WorkerFetchHandler = (
  request: Request,
  env: CloudflareEnv
) => Promise<Response>

/**
 * Worker handler with standard Cloudflare shape
 */
export interface WorkerHandler {
  fetch: WorkerFetchHandler
}

// =============================================================================
// RE-EXPORTS FOR COMPATIBILITY
// =============================================================================

// Re-export from load-balancing-graph for backward compatibility
export type {
  WorkerStatus as GraphWorkerStatus,
  LoadBalancerStrategy as GraphLoadBalancerStrategy,
  WorkerRegistration as GraphWorkerRegistration,
  WorkerNode as GraphWorkerNode,
  TaskRequest as GraphTaskRequest,
  RouteResult as GraphRouteResult,
  WorkerLoadMetrics as GraphWorkerLoadMetrics,
  RouteOptions as GraphRouteOptions,
  StatusHistoryEntry as GraphStatusHistoryEntry,
  RoutingHistoryEntry as GraphRoutingHistoryEntry,
  ClusterUtilization as GraphClusterUtilization,
}

// Re-export ProxyConfig for backward compatibility with hostname-proxy
export type { ProxyConfig as HostnameProxyConfig }

// =============================================================================
// MESSAGE BUS TYPES
// =============================================================================

/**
 * Message types for worker communication
 */
export type MessageType = 'request' | 'response' | 'notification' | 'handoff' | 'error'

/**
 * Message delivery status
 */
export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'expired'

/**
 * Message sent between workers/agents
 */
export interface WorkerMessage<T = unknown> {
  /** Unique message identifier */
  id: string
  /** Sending worker ID */
  sender: string
  /** Receiving worker ID */
  recipient: string
  /** Message type */
  type: MessageType
  /** Message payload */
  payload: T
  /** When the message was created */
  timestamp: Date
  /** Optional: ID of message this is responding to */
  replyTo?: string
  /** Optional: Time-to-live in milliseconds */
  ttlMs?: number
  /** Optional: Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Message envelope with delivery metadata
 */
export interface MessageEnvelope<T = unknown> {
  /** The wrapped message */
  message: WorkerMessage<T>
  /** Number of delivery attempts */
  deliveryAttempts: number
  /** When the envelope was created */
  createdAt: Date
  /** Current delivery status */
  status: DeliveryStatus
  /** When the message was delivered (if applicable) */
  deliveredAt?: Date
  /** Error message if delivery failed */
  error?: string
}

/**
 * Message bus configuration
 */
export interface BusConfig {
  /** Default TTL for messages in milliseconds */
  defaultTtlMs?: number
  /** Maximum delivery attempts */
  maxDeliveryAttempts?: number
  /** Retry delay in milliseconds */
  retryDelayMs?: number
}

/**
 * Message filter criteria
 */
export interface MessageFilter {
  /** Filter by message type */
  type?: MessageType
  /** Filter by sender */
  sender?: string
  /** Filter by recipient */
  recipient?: string
  /** Messages since this date */
  since?: Date
  /** Messages until this date */
  until?: Date
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

// =============================================================================
// HANDOFF TYPES
// =============================================================================

/**
 * Reason for initiating a handoff
 */
export type HandoffReason =
  | 'specialization' // Target worker has better capabilities
  | 'escalation' // Issue requires higher authority
  | 'delegation' // Parallel task delegation
  | 'completion' // Current worker completed its part
  | 'routing' // Initial routing decision
  | 'error' // Current worker cannot proceed
  | 'custom' // Custom reason with description

/**
 * State of a handoff in progress
 */
export type HandoffState =
  | 'pending' // Handoff initiated but not started
  | 'transferring' // Context being transferred
  | 'active' // Target worker is executing
  | 'completed' // Handoff completed successfully
  | 'failed' // Handoff failed
  | 'cancelled' // Handoff was cancelled

/**
 * Context transferred during a handoff
 */
export interface HandoffContext {
  /** Messages to transfer */
  messages: unknown[]
  /** Tool calls made by source */
  toolCalls?: unknown[]
  /** Tool results from source */
  toolResults?: unknown[]
  /** Metadata to preserve */
  metadata?: Record<string, unknown>
  /** Summary of work done */
  summary?: string
  /** Instructions for target */
  instructions?: string
  /** Variables to pass along */
  variables?: Record<string, unknown>
}

/**
 * Handoff request
 */
export interface HandoffRequest {
  /** Unique identifier */
  id: string
  /** Source worker ID */
  sourceId: string
  /** Target worker ID */
  targetId: string
  /** Handoff reason */
  reason: HandoffReason
  /** Human-readable description */
  reasonDescription?: string
  /** Context to transfer */
  context: HandoffContext
  /** When initiated */
  initiatedAt: Date
  /** Priority level */
  priority?: number
  /** Timeout in milliseconds */
  timeoutMs?: number
}

/**
 * Result of a completed handoff
 */
export interface HandoffResult {
  /** The request that was executed */
  request: HandoffRequest
  /** Current state */
  state: HandoffState
  /** Result (if successful) */
  result?: unknown
  /** Error (if failed) */
  error?: Error
  /** When completed */
  completedAt?: Date
  /** Duration in milliseconds */
  durationMs?: number
}

/**
 * Entry in the handoff chain
 */
export interface HandoffChainEntry {
  /** Worker ID */
  workerId: string
  /** When started */
  startedAt: Date
  /** When completed */
  completedAt?: Date
  /** Summary */
  summary?: string
  /** Reason for passing to next */
  handoffReason?: HandoffReason
}

// =============================================================================
// ESCALATION TYPES
// =============================================================================

/**
 * Escalation options
 */
export interface EscalationOptions {
  /** Reason for escalation */
  reason: string
  /** SLA in milliseconds */
  sla?: number
  /** Priority level (1-5, 1 = highest) */
  priority?: number
  /** Communication channel */
  channel?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Escalation data stored in graph
 */
export interface EscalationData {
  reason: string
  sla?: number
  expiresAt?: number
  priority?: number
  channel?: string
  metadata?: Record<string, unknown>
}

/**
 * Escalation relationship (stored in graph)
 */
export interface EscalationRelationship {
  id: string
  /** Verb form encoding state: 'escalate', 'escalating', 'escalated' */
  verb: string
  /** Source: workflow instance URL */
  from: string
  /** Target: Human DO URL */
  to: string
  /** Escalation data */
  data: EscalationData
  /** Creation timestamp */
  createdAt: number
  /** Last update timestamp */
  updatedAt: number
}

/**
 * SLA status information
 */
export interface SLAStatus {
  hasExpired: boolean
  timeRemaining: number
  expiresAt: Date | null
}

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

/**
 * Workflow execution state
 */
export type WorkflowState = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

/**
 * Workflow step result
 */
export interface WorkflowStepResult {
  stepId: string
  workerId: string
  state: WorkflowState
  result?: unknown
  error?: string
  startedAt: number
  completedAt?: number
}

/**
 * AI workflow task
 */
export interface AIWorkflowTask {
  id: string
  type: string
  prompt: string
  model?: string
  systemPrompt?: string
  tools?: string[]
  maxTokens?: number
  temperature?: number
  metadata?: Record<string, unknown>
}

/**
 * Worker tier for routing decisions
 */
export type WorkerTier = 'primary' | 'secondary' | 'fallback'

// =============================================================================
// EVENT TYPES
// =============================================================================

/**
 * Worker events for observability
 */
export type WorkerEventType =
  | 'worker.registered'
  | 'worker.deregistered'
  | 'worker.status.changed'
  | 'task.routed'
  | 'task.completed'
  | 'task.failed'
  | 'handoff.initiated'
  | 'handoff.completed'
  | 'handoff.failed'
  | 'escalation.created'
  | 'escalation.resolved'
  | 'message.sent'
  | 'message.delivered'
  | 'message.failed'

/**
 * Worker event payload
 */
export interface WorkerEvent<T = unknown> {
  type: WorkerEventType
  timestamp: Date
  workerId?: string
  data: T
}
