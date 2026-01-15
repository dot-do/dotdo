/**
 * @module @dotdo/worker-types
 * @description Shared TypeScript interfaces and type guards for dotdo workers, agents, and humans
 *
 * This package provides comprehensive type definitions for:
 * - **Workers**: Base interfaces for work-performing entities
 * - **Agents**: AI-powered autonomous workers with tools and memory
 * - **Humans**: Human participants in workflows with approval queues
 * - **Routing**: Worker routing, load balancing, and inter-worker communication
 * - **Guards**: Runtime type guards for all types
 *
 * @example
 * ```typescript
 * import type { IWorker, IAgent, IHuman, Task, TaskResult } from '@dotdo/worker-types'
 * import { isWorker, isAgent, isHuman } from '@dotdo/worker-types'
 *
 * // Type-safe worker handling
 * function handleWorker(worker: IWorker) {
 *   if (isAgent(worker)) {
 *     // TypeScript knows worker is IAgent
 *     const tools = worker.getTools()
 *   } else if (isHuman(worker)) {
 *     // TypeScript knows worker is IHuman
 *     const channels = await worker.getChannels()
 *   }
 * }
 * ```
 */

// =============================================================================
// Worker Types
// =============================================================================

export type {
  WorkerMode,
  Task,
  TaskResult,
  Context,
  Answer,
  Option,
  Decision,
  ApprovalRequest,
  ApprovalResult,
  Channel,
  IWorker,
  WorkerConfig,
} from './worker'

// =============================================================================
// Agent Types
// =============================================================================

export type {
  Tool,
  ToolDefinition,
  Goal,
  GoalResult,
  MemoryType,
  Memory,
  MemorySearchOptions,
  IAgent,
  AgentConfig,
  AgentLoopStep,
  AgentLoopState,
} from './agent'

// =============================================================================
// Human Types
// =============================================================================

export type {
  NotificationPriority,
  NotificationChannel,
  EscalationRule,
  EscalationPolicy,
  PendingApproval,
  BlockingApprovalStatus,
  BlockingApprovalType,
  BlockingApprovalRequest,
  IHuman,
  HumanConfig,
} from './human'

// =============================================================================
// Routing Types
// =============================================================================

export type {
  ProxyMode,
  HostnameConfig,
  FixedNamespaceConfig,
  BaseProxyConfig,
  ProxyConfig,
  APIConfig,
  NamespaceResolveResult,
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
  MessageType,
  DeliveryStatus,
  WorkerMessage,
  MessageEnvelope,
  BusConfig,
  MessageFilter,
  HandoffReason,
  HandoffState,
  HandoffContext,
  HandoffRequest,
  HandoffResult,
  HandoffChainEntry,
  EscalationOptions,
  EscalationData,
  SLAStatus,
  WorkflowState,
  WorkflowStepResult,
  WorkerTier,
  WorkerEventType,
  WorkerEvent,
} from './routing'

// =============================================================================
// Type Guards
// =============================================================================

export {
  // Worker guards
  isWorkerMode,
  isWorker,
  isTask,
  isTaskResult,
  isApprovalRequest,
  isApprovalResult,
  isChannel,
  isAnswer,
  isOption,
  isDecision,
  isWorkerConfig,
  // Agent guards
  isAgent,
  isTool,
  isGoal,
  isGoalResult,
  isMemoryType,
  isMemory,
  isAgentConfig,
  // Human guards
  isHuman,
  isNotificationChannel,
  isEscalationPolicy,
  isBlockingApprovalStatus,
  isBlockingApprovalRequest,
  isHumanConfig,
  // Routing guards
  isWorkerStatus,
  isLoadBalancerStrategy,
  isWorkerNode,
  isTaskRequest,
  isRouteResult,
  isMessageType,
  isDeliveryStatus,
  isWorkerMessage,
  isHandoffState,
  isHandoffRequest,
  isWorkflowState,
} from './guards'
