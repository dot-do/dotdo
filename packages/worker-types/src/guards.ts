/**
 * @module guards
 * @description Type guards for runtime type checking
 *
 * Provides runtime type guards for validating worker, agent, and human
 * instances and configurations.
 */

import type { IWorker, Task, TaskResult, ApprovalRequest, ApprovalResult, WorkerMode, WorkerConfig, Answer, Option, Decision, Channel, Context } from './worker'
import type { IAgent, Tool, Goal, GoalResult, Memory, MemoryType, AgentConfig } from './agent'
import type { IHuman, NotificationChannel, EscalationPolicy, BlockingApprovalRequest, BlockingApprovalStatus, HumanConfig } from './human'
import type { WorkerNode, WorkerStatus, TaskRequest, RouteResult, LoadBalancerStrategy, WorkerMessage, MessageType, DeliveryStatus, HandoffRequest, HandoffState, WorkflowState } from './routing'

// =============================================================================
// WORKER GUARDS
// =============================================================================

/**
 * Check if value is a valid WorkerMode
 */
export function isWorkerMode(value: unknown): value is WorkerMode {
  return value === 'autonomous' || value === 'supervised' || value === 'manual'
}

/**
 * Check if value implements IWorker interface
 */
export function isWorker(value: unknown): value is IWorker {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.executeWork === 'function' &&
    typeof obj.ask === 'function' &&
    typeof obj.decide === 'function' &&
    typeof obj.approve === 'function' &&
    typeof obj.generate === 'function' &&
    typeof obj.notify === 'function' &&
    typeof obj.getMode === 'function' &&
    typeof obj.setMode === 'function'
  )
}

/**
 * Check if value is a valid Task
 */
export function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.input === 'object' && obj.input !== null
  )
}

/**
 * Check if value is a valid TaskResult
 */
export function isTaskResult(value: unknown): value is TaskResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.success === 'boolean'
}

/**
 * Check if value is a valid ApprovalRequest
 */
export function isApprovalRequest(value: unknown): value is ApprovalRequest {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.requester === 'string' &&
    typeof obj.data === 'object' && obj.data !== null
  )
}

/**
 * Check if value is a valid ApprovalResult
 */
export function isApprovalResult(value: unknown): value is ApprovalResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.approved === 'boolean' &&
    typeof obj.approver === 'string'
  )
}

/**
 * Check if value is a valid Channel
 */
export function isChannel(value: unknown): value is Channel {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    (obj.type === 'email' || obj.type === 'slack' || obj.type === 'sms' || obj.type === 'webhook') &&
    typeof obj.target === 'string'
  )
}

/**
 * Check if value is a valid Answer
 */
export function isAnswer(value: unknown): value is Answer {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj.text === 'string'
}

/**
 * Check if value is a valid Option
 */
export function isOption(value: unknown): value is Option {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.label === 'string'
  )
}

/**
 * Check if value is a valid Decision
 */
export function isDecision(value: unknown): value is Decision {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return isOption(obj.selectedOption)
}

/**
 * Check if value is a valid WorkerConfig
 */
export function isWorkerConfig(value: unknown): value is WorkerConfig {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.mode !== undefined && !isWorkerMode(obj.mode)) return false
  if (obj.channels !== undefined) {
    if (!Array.isArray(obj.channels)) return false
    if (!obj.channels.every(isChannel)) return false
  }
  return true
}

// =============================================================================
// AGENT GUARDS
// =============================================================================

/**
 * Check if value implements IAgent interface
 */
export function isAgent(value: unknown): value is IAgent {
  if (!isWorker(value)) return false
  const obj = value as unknown as Record<string, unknown>
  return (
    typeof obj.registerTool === 'function' &&
    typeof obj.getTools === 'function' &&
    typeof obj.executeTool === 'function' &&
    typeof obj.run === 'function' &&
    typeof obj.remember === 'function' &&
    typeof obj.getRecentMemories === 'function' &&
    typeof obj.searchMemories === 'function'
  )
}

/**
 * Check if value is a valid Tool
 */
export function isTool(value: unknown): value is Tool {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.parameters === 'object' && obj.parameters !== null &&
    typeof obj.handler === 'function'
  )
}

/**
 * Check if value is a valid Goal
 */
export function isGoal(value: unknown): value is Goal {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.description === 'string'
  )
}

/**
 * Check if value is a valid GoalResult
 */
export function isGoalResult(value: unknown): value is GoalResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.success === 'boolean' &&
    typeof obj.iterations === 'number' &&
    Array.isArray(obj.actions)
  )
}

/**
 * Check if value is a valid MemoryType
 */
export function isMemoryType(value: unknown): value is MemoryType {
  return value === 'short-term' || value === 'long-term' || value === 'episodic'
}

/**
 * Check if value is a valid Memory
 */
export function isMemory(value: unknown): value is Memory {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    isMemoryType(obj.type) &&
    typeof obj.content === 'string' &&
    obj.createdAt instanceof Date
  )
}

/**
 * Check if value is a valid AgentConfig
 */
export function isAgentConfig(value: unknown): value is AgentConfig {
  if (!isWorkerConfig(value)) return false
  const obj = value as Record<string, unknown>
  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) return false
    if (!obj.tools.every(isTool)) return false
  }
  if (obj.defaultMemoryType !== undefined && !isMemoryType(obj.defaultMemoryType)) return false
  return true
}

// =============================================================================
// HUMAN GUARDS
// =============================================================================

/**
 * Check if value implements IHuman interface
 */
export function isHuman(value: unknown): value is IHuman {
  if (!isWorker(value)) return false
  const obj = value as unknown as Record<string, unknown>
  return (
    typeof obj.setChannels === 'function' &&
    typeof obj.getChannels === 'function' &&
    typeof obj.setEscalationPolicy === 'function' &&
    typeof obj.getEscalationPolicy === 'function' &&
    typeof obj.requestApproval === 'function' &&
    typeof obj.submitApproval === 'function' &&
    typeof obj.getPendingApprovals === 'function' &&
    typeof obj.checkEscalations === 'function'
  )
}

/**
 * Check if value is a valid NotificationChannel
 */
export function isNotificationChannel(value: unknown): value is NotificationChannel {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  const validTypes = ['email', 'slack', 'sms', 'webhook', 'discord']
  const validPriorities = ['low', 'normal', 'high', 'urgent']
  return (
    validTypes.includes(obj.type as string) &&
    typeof obj.target === 'string' &&
    validPriorities.includes(obj.priority as string)
  )
}

/**
 * Check if value is a valid EscalationPolicy
 */
export function isEscalationPolicy(value: unknown): value is EscalationPolicy {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.rules)) return false
  for (const rule of obj.rules) {
    if (typeof rule !== 'object' || rule === null) return false
    const r = rule as Record<string, unknown>
    if (typeof r.afterMinutes !== 'number') return false
    if (typeof r.escalateTo !== 'string') return false
    if (!Array.isArray(r.notifyChannels)) return false
    if (!r.notifyChannels.every(isNotificationChannel)) return false
  }
  return true
}

/**
 * Check if value is a valid BlockingApprovalStatus
 */
export function isBlockingApprovalStatus(value: unknown): value is BlockingApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'rejected' || value === 'expired'
}

/**
 * Check if value is a valid BlockingApprovalRequest
 */
export function isBlockingApprovalRequest(value: unknown): value is BlockingApprovalRequest {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.requestId === 'string' &&
    typeof obj.role === 'string' &&
    typeof obj.message === 'string' &&
    (obj.type === 'approval' || obj.type === 'question' || obj.type === 'review') &&
    typeof obj.createdAt === 'string' &&
    isBlockingApprovalStatus(obj.status)
  )
}

/**
 * Check if value is a valid HumanConfig
 */
export function isHumanConfig(value: unknown): value is HumanConfig {
  if (!isWorkerConfig(value)) return false
  const obj = value as Record<string, unknown>
  if (obj.notificationChannels !== undefined) {
    if (!Array.isArray(obj.notificationChannels)) return false
    if (!obj.notificationChannels.every(isNotificationChannel)) return false
  }
  if (obj.escalationPolicy !== undefined && !isEscalationPolicy(obj.escalationPolicy)) return false
  return true
}

// =============================================================================
// ROUTING GUARDS
// =============================================================================

/**
 * Check if value is a valid WorkerStatus
 */
export function isWorkerStatus(value: unknown): value is WorkerStatus {
  return value === 'available' || value === 'busy' || value === 'offline'
}

/**
 * Check if value is a valid LoadBalancerStrategy
 */
export function isLoadBalancerStrategy(value: unknown): value is LoadBalancerStrategy {
  return value === 'round-robin' || value === 'least-busy' || value === 'capability' || value === 'weighted'
}

/**
 * Check if value is a valid WorkerNode
 */
export function isWorkerNode(value: unknown): value is WorkerNode {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.endpoint === 'string' &&
    isWorkerStatus(obj.status) &&
    Array.isArray(obj.capabilities)
  )
}

/**
 * Check if value is a valid TaskRequest
 */
export function isTaskRequest(value: unknown): value is TaskRequest {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string'
  )
}

/**
 * Check if value is a valid RouteResult
 */
export function isRouteResult(value: unknown): value is RouteResult {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    isLoadBalancerStrategy(obj.strategy) &&
    typeof obj.timestamp === 'number'
  )
}

/**
 * Check if value is a valid MessageType
 */
export function isMessageType(value: unknown): value is MessageType {
  return value === 'request' || value === 'response' || value === 'notification' || value === 'handoff' || value === 'error'
}

/**
 * Check if value is a valid DeliveryStatus
 */
export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return value === 'pending' || value === 'delivered' || value === 'failed' || value === 'expired'
}

/**
 * Check if value is a valid WorkerMessage
 */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.sender === 'string' &&
    typeof obj.recipient === 'string' &&
    isMessageType(obj.type) &&
    obj.timestamp instanceof Date
  )
}

/**
 * Check if value is a valid HandoffState
 */
export function isHandoffState(value: unknown): value is HandoffState {
  const states = ['pending', 'transferring', 'active', 'completed', 'failed', 'cancelled']
  return states.includes(value as string)
}

/**
 * Check if value is a valid HandoffRequest
 */
export function isHandoffRequest(value: unknown): value is HandoffRequest {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.sourceId === 'string' &&
    typeof obj.targetId === 'string' &&
    typeof obj.reason === 'string' &&
    typeof obj.context === 'object' && obj.context !== null &&
    obj.initiatedAt instanceof Date
  )
}

/**
 * Check if value is a valid WorkflowState
 */
export function isWorkflowState(value: unknown): value is WorkflowState {
  return value === 'pending' || value === 'running' || value === 'paused' || value === 'completed' || value === 'failed'
}
