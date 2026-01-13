/**
 * Human Approval Workflows
 *
 * Shared workflow logic for approval chains including:
 * - Sequential approval (one after another)
 * - Parallel approval (all at once, quorum-based)
 * - Conditional approval (based on input conditions)
 * - Escalation chains
 *
 * Used by both HumanFunctionExecutor and Human DO.
 *
 * @module lib/human/workflows
 */

import type { ChannelConfig, HumanNotificationPayload, HumanResponse } from './channels'
import { HumanChannelError } from './channels'

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when approval is rejected
 */
export class HumanApprovalRejectedError extends Error {
  rejectedBy?: string
  level?: string

  constructor(message: string, rejectedBy?: string, level?: string) {
    super(message)
    this.name = 'HumanApprovalRejectedError'
    this.rejectedBy = rejectedBy
    this.level = level
  }
}

/**
 * Error thrown when escalation fails
 */
export class HumanEscalationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanEscalationError'
  }
}

/**
 * Error thrown when a request times out
 */
export class HumanTimeoutError extends Error {
  timeout: number
  requestId?: string

  constructor(message: string, timeout?: number, requestId?: string) {
    super(message)
    this.name = 'HumanTimeoutError'
    this.timeout = timeout ?? 0
    this.requestId = requestId
  }
}

/**
 * Error thrown when a request is cancelled
 */
export class HumanCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanCancelledError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Approval level in a sequential workflow
 */
export interface ApprovalLevel {
  name: string
  users: string[]
}

/**
 * Approval workflow configuration
 */
export interface ApprovalWorkflow {
  type: 'sequential' | 'parallel' | 'conditional'
  levels?: ApprovalLevel[]
  users?: string[]
  requiredApprovals?: number
  failFast?: boolean
  conditions?: Array<{
    when: (input: unknown) => boolean
    users: string[]
    sequential?: boolean
  }>
}

/**
 * Escalation chain configuration
 */
export interface EscalationConfig {
  timeout: number
  to: string
  channelOptions?: Record<string, unknown>
  next?: EscalationConfig
}

/**
 * Result of an approval workflow
 */
export interface ApprovalWorkflowResult {
  action: 'approve' | 'reject'
  approvals: Array<{ userId: string; action: string; timestamp: Date }>
  rejectedBy?: string
  rejectionLevel?: string
  approvalCount?: number
  rejectionCount?: number
}

/**
 * Context for workflow execution
 */
export interface WorkflowContext {
  channel: ChannelConfig
  buildPayload: (message: string, mentions?: string[]) => HumanNotificationPayload
  timeout: number
  onNotificationSent?: () => void
}

// ============================================================================
// SEQUENTIAL APPROVAL
// ============================================================================

/**
 * Execute a sequential approval workflow
 *
 * Each level must approve before proceeding to the next.
 * Any rejection stops the workflow.
 */
export async function executeSequentialApproval(
  workflow: ApprovalWorkflow,
  context: WorkflowContext,
  message: string
): Promise<ApprovalWorkflowResult> {
  const levels = workflow.levels || []
  const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []

  for (const level of levels) {
    const payload = context.buildPayload(message, level.users)

    await context.channel.send(payload)
    context.onNotificationSent?.()

    const response = await context.channel.waitForResponse({ timeout: context.timeout })

    approvals.push({
      userId: response.userId,
      action: response.action,
      timestamp: response.timestamp,
    })

    if (response.action === 'reject') {
      return {
        action: 'reject',
        approvals,
        rejectedBy: response.userId,
        rejectionLevel: level.name,
      }
    }
  }

  return {
    action: 'approve',
    approvals,
  }
}

// ============================================================================
// PARALLEL APPROVAL
// ============================================================================

/**
 * Execute a parallel approval workflow
 *
 * All users are notified at once. The workflow succeeds
 * when requiredApprovals is reached, or fails if not possible.
 */
export async function executeParallelApproval(
  workflow: ApprovalWorkflow,
  context: WorkflowContext,
  message: string
): Promise<ApprovalWorkflowResult> {
  const users = workflow.users || []
  const requiredApprovals = workflow.requiredApprovals || users.length
  const failFast = workflow.failFast || false

  const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []
  let approvalCount = 0
  let rejectionCount = 0

  // Send to all users
  for (const _user of users) {
    const payload = context.buildPayload(message)
    await context.channel.send(payload)
    context.onNotificationSent?.()
  }

  // Collect responses
  for (let i = 0; i < users.length; i++) {
    // Check if we can fast-fail
    if (failFast) {
      const remainingUsers = users.length - i
      const maxPossibleApprovals = approvalCount + remainingUsers
      if (maxPossibleApprovals < requiredApprovals) {
        break
      }
    }

    // Check if we already have enough approvals
    if (approvalCount >= requiredApprovals) {
      break
    }

    const response = await context.channel.waitForResponse({ timeout: context.timeout })
    approvals.push({
      userId: response.userId,
      action: response.action,
      timestamp: response.timestamp,
    })

    if (response.action === 'approve') {
      approvalCount++
    } else {
      rejectionCount++
    }
  }

  const success = approvalCount >= requiredApprovals
  return {
    action: success ? 'approve' : 'reject',
    approvals,
    approvalCount,
    rejectionCount,
  }
}

// ============================================================================
// CONDITIONAL APPROVAL
// ============================================================================

/**
 * Execute a conditional approval workflow
 *
 * Routes to different approvers based on input conditions.
 */
export async function executeConditionalApproval(
  workflow: ApprovalWorkflow,
  context: WorkflowContext,
  message: string,
  input: unknown
): Promise<ApprovalWorkflowResult> {
  const conditions = workflow.conditions || []

  // Find matching condition
  const matchingCondition = conditions.find((c) => c.when(input))
  if (!matchingCondition) {
    throw new HumanChannelError('No matching approval condition found')
  }

  const users = matchingCondition.users
  const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []

  if (matchingCondition.sequential) {
    // Sequential approval for matching users
    for (const user of users) {
      const payload = context.buildPayload(message, [user])
      await context.channel.send(payload)
      context.onNotificationSent?.()

      const response = await context.channel.waitForResponse({ timeout: context.timeout })
      approvals.push({
        userId: response.userId,
        action: response.action,
        timestamp: response.timestamp,
      })

      if (response.action === 'reject') {
        return {
          action: 'reject',
          approvals,
          rejectedBy: response.userId,
        }
      }
    }
  } else {
    // Single approval from any matching user
    const payload = context.buildPayload(message, users)
    await context.channel.send(payload)
    context.onNotificationSent?.()

    const response = await context.channel.waitForResponse({ timeout: context.timeout })
    approvals.push({
      userId: response.userId,
      action: response.action,
      timestamp: response.timestamp,
    })

    return {
      action: response.action === 'approve' ? 'approve' : 'reject',
      approvals,
      rejectedBy: response.action === 'reject' ? response.userId : undefined,
    }
  }

  return {
    action: 'approve',
    approvals,
  }
}

// ============================================================================
// ESCALATION
// ============================================================================

/**
 * Options for handling escalation
 */
export interface EscalationOptions {
  escalation: EscalationConfig
  currentLevel: number
  channels: Map<string, ChannelConfig> | Record<string, ChannelConfig>
  onEscalated?: (fromChannel: string, toChannel: string, level: number) => void | Promise<void>
}

/**
 * Build an escalated task configuration
 */
export function buildEscalatedTask<T extends { channel: string; timeout: number; channelOptions?: Record<string, unknown>; escalation?: EscalationConfig }>(
  originalTask: T,
  escalationOptions: EscalationOptions
): T {
  const { escalation } = escalationOptions

  return {
    ...originalTask,
    channel: escalation.to,
    timeout: escalation.next?.timeout || escalation.timeout,
    channelOptions: {
      ...originalTask.channelOptions,
      [escalation.to]: escalation.channelOptions,
    },
    escalation: escalation.next,
  }
}

/**
 * Check if escalation is available
 */
export function hasEscalation(escalation: EscalationConfig | undefined): escalation is EscalationConfig {
  return escalation !== undefined && escalation.to !== undefined
}

// ============================================================================
// TIMEOUT HANDLING
// ============================================================================

/**
 * Default response on timeout
 */
export interface DefaultOnTimeout {
  action: string
  reason: string
}

/**
 * Create a default response for timeout scenarios
 */
export function createTimeoutDefaultResponse(config: DefaultOnTimeout): HumanResponse {
  return {
    action: config.action,
    userId: 'system',
    timestamp: new Date(),
    data: { reason: config.reason },
    isDefault: true,
  }
}

/**
 * Create a promise that rejects after a timeout
 */
export function createTimeoutPromise(timeout: number, requestId?: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new HumanTimeoutError(`Timeout after ${timeout}ms`, timeout, requestId))
    }, timeout)
  })
}

/**
 * Create a promise that rejects when an abort signal fires
 */
export function createAbortPromise(
  signal: AbortSignal,
  onAbort?: () => void | Promise<void>
): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', async () => {
      if (onAbort) {
        await onAbort()
      }
      reject(new HumanCancelledError('Task cancelled'))
    })
  })
}

// ============================================================================
// WORKFLOW EXECUTOR
// ============================================================================

/**
 * Execute an approval workflow based on its type
 */
export async function executeApprovalWorkflow(
  workflow: ApprovalWorkflow,
  context: WorkflowContext,
  message: string,
  input?: unknown
): Promise<ApprovalWorkflowResult> {
  switch (workflow.type) {
    case 'sequential':
      return executeSequentialApproval(workflow, context, message)
    case 'parallel':
      return executeParallelApproval(workflow, context, message)
    case 'conditional':
      return executeConditionalApproval(workflow, context, message, input)
    default:
      throw new HumanChannelError(`Unknown approval workflow type: ${(workflow as ApprovalWorkflow).type}`)
  }
}

export default {
  HumanApprovalRejectedError,
  HumanEscalationError,
  HumanTimeoutError,
  HumanCancelledError,
  executeSequentialApproval,
  executeParallelApproval,
  executeConditionalApproval,
  executeApprovalWorkflow,
  buildEscalatedTask,
  hasEscalation,
  createTimeoutDefaultResponse,
  createTimeoutPromise,
  createAbortPromise,
}
