/**
 * @module lib/executors/HumanFunctionExecutor
 *
 * HumanFunctionExecutor - Execute functions requiring human input and approval.
 *
 * This executor queues tasks for human review and waits for their response. It is
 * the slowest but most reliable execution mode, guaranteeing human judgment for
 * critical decisions. It supports multiple notification channels, structured forms,
 * timeout handling, escalation chains, and complex approval workflows.
 *
 * ## Features
 *
 * - **Multi-Channel Notifications**: Slack, email, in-app, Discord, SMS
 * - **Structured Forms**: Collect rich input with validation
 * - **Action Buttons**: Simple approve/reject or custom actions
 * - **Timeout Handling**: Default responses or escalation on timeout
 * - **Escalation Chains**: Automatic escalation to backup approvers
 * - **Approval Workflows**: Sequential, parallel, or conditional approvals
 * - **Response Validation**: Schema validation and custom validators
 * - **Audit Trail**: Persistent logging of all decisions
 *
 * ## Channel Support
 *
 * Each channel has specific configuration options:
 * - **Slack**: Channel, user mentions, interactive buttons
 * - **Email**: To, subject, HTML/text content, action links
 * - **In-App**: User ID, priority, push notifications
 *
 * ## Approval Workflow Types
 *
 * - **Sequential**: Each level must approve before the next
 * - **Parallel**: All users notified, requires N approvals
 * - **Conditional**: Different approval paths based on input
 *
 * This is a thin wrapper around the shared abstractions in lib/human.
 * All core logic is delegated to the shared modules to eliminate duplication
 * with objects/Human.ts and ensure consistent behavior.
 *
 * @example Basic Human Task
 * ```typescript
 * import { HumanFunctionExecutor } from 'dotdo/lib/executors'
 *
 * // Configure channels
 * const channels = {
 *   slack: {
 *     send: async (payload) => slackClient.postMessage(payload),
 *     waitForResponse: async (opts) => slackClient.waitForAction(opts)
 *   },
 *   email: {
 *     send: async (payload) => emailService.send(payload),
 *     waitForResponse: async (opts) => emailService.waitForClick(opts)
 *   }
 * }
 *
 * // Create executor
 * const executor = new HumanFunctionExecutor({
 *   state: this.state,
 *   env: this.env,
 *   channels,
 *   notificationService,
 *   onEvent: (event, data) => console.log(event, data)
 * })
 *
 * // Request human approval
 * const result = await executor.execute({
 *   prompt: 'Approve refund of ${{amount}} for order {{orderId}}?',
 *   channel: 'slack',
 *   timeout: 3600000, // 1 hour
 *   input: { amount: 150, orderId: 'ORD-123' },
 *   actions: ['approve', 'reject'],
 *   channelOptions: {
 *     slackChannel: '#approvals',
 *     mentionUsers: ['@finance-team']
 *   }
 * })
 *
 * if (result.success && result.response?.action === 'approve') {
 *   await processRefund(result.response.data)
 * }
 * ```
 *
 * @example Structured Form Input
 * ```typescript
 * // Collect structured data from human
 * const result = await executor.execute({
 *   prompt: 'Review and adjust the pricing for {{product}}',
 *   channel: 'in-app',
 *   timeout: 86400000, // 24 hours
 *   input: { product: 'Enterprise Plan' },
 *   form: {
 *     fields: [
 *       {
 *         name: 'price',
 *         label: 'Monthly Price',
 *         type: 'number',
 *         required: true,
 *         validation: { min: 0, max: 10000 }
 *       },
 *       {
 *         name: 'discount',
 *         label: 'Discount %',
 *         type: 'number',
 *         default: 0
 *       },
 *       {
 *         name: 'notes',
 *         label: 'Pricing Rationale',
 *         type: 'textarea'
 *       }
 *     ]
 *   },
 *   applyDefaults: true,
 *   channelOptions: {
 *     userId: 'pricing-manager-123',
 *     priority: 'high'
 *   }
 * })
 *
 * if (result.success) {
 *   const { price, discount, notes } = result.response.data
 *   await updatePricing(price, discount)
 * }
 * ```
 *
 * @example Multi-Level Approval Workflow
 * ```typescript
 * // Sequential approval through multiple levels
 * const result = await executor.execute({
 *   prompt: 'Approve contract for {{vendor}} - ${{amount}}',
 *   channel: 'email',
 *   timeout: 172800000, // 48 hours per level
 *   input: { vendor: 'Acme Corp', amount: 50000 },
 *   approval: {
 *     type: 'sequential',
 *     levels: [
 *       { name: 'manager', users: ['manager@company.com'] },
 *       { name: 'director', users: ['director@company.com'] },
 *       { name: 'cfo', users: ['cfo@company.com'] }
 *     ],
 *     failFast: true // Stop on first rejection
 *   },
 *   channelOptions: {
 *     subject: 'Contract Approval Required: {{vendor}}',
 *     contentType: 'html'
 *   }
 * })
 *
 * console.log('Approval count:', result.response?.approvalCount)
 * console.log('Rejected by:', result.response?.rejectedBy)
 * ```
 *
 * @example Parallel Approval with Quorum
 * ```typescript
 * // Require N of M approvals
 * const result = await executor.execute({
 *   prompt: 'Approve release of v{{version}}',
 *   channel: 'slack',
 *   timeout: 3600000,
 *   input: { version: '2.0.0' },
 *   approval: {
 *     type: 'parallel',
 *     users: ['@alice', '@bob', '@charlie', '@diana'],
 *     requiredApprovals: 2 // Need 2 of 4
 *   }
 * })
 * ```
 *
 * @example Escalation Chain
 * ```typescript
 * // Escalate to backup approvers on timeout
 * const result = await executor.execute({
 *   prompt: 'Urgent: Approve deployment to production',
 *   channel: 'slack',
 *   timeout: 1800000, // 30 minutes
 *   escalation: {
 *     timeout: 1800000,
 *     to: '@tech-lead',
 *     next: {
 *       timeout: 900000, // 15 minutes
 *       to: '@vp-engineering',
 *       next: {
 *         timeout: 300000, // 5 minutes
 *         to: '@cto'
 *       }
 *     }
 *   }
 * })
 *
 * if (result.escalated) {
 *   console.log('Escalated to level:', result.escalationLevel)
 * }
 * ```
 *
 * @example Default Response on Timeout
 * ```typescript
 * // Auto-approve or reject if no response
 * const result = await executor.execute({
 *   prompt: 'Review content for publication',
 *   channel: 'email',
 *   timeout: 86400000, // 24 hours
 *   defaultOnTimeout: {
 *     action: 'approve',
 *     reason: 'Auto-approved due to no response within SLA'
 *   }
 * })
 *
 * if (result.response?.isDefault) {
 *   console.log('Approved by default:', result.response.data.reason)
 * }
 * ```
 *
 * @example Multi-Channel Notification
 * ```typescript
 * // Send to multiple channels, first response wins
 * const result = await executor.execute({
 *   prompt: 'Approve access request for {{user}}',
 *   channel: ['slack', 'email', 'in-app'],
 *   timeout: 7200000, // 2 hours
 *   input: { user: 'new-employee@company.com' },
 *   channelOptions: {
 *     slack: { slackChannel: '#it-approvals' },
 *     email: { to: 'it-admin@company.com' },
 *     'in-app': { userId: 'it-admin-123' }
 *   }
 * })
 *
 * console.log('Responded via:', result.channel)
 * ```
 *
 * @see {@link CascadeExecutor} for automatic fallback to human on AI failure
 * @see {@link lib/human} for shared human workflow abstractions
 */

// ============================================================================
// RE-EXPORTS FROM SHARED MODULES
// ============================================================================

// Re-export error classes from shared modules for backward compatibility
export {
  HumanChannelError,
  HumanNotificationFailedError,
  HumanValidationError,
  HumanTimeoutError,
  HumanCancelledError,
  HumanEscalationError,
  HumanApprovalRejectedError,
} from '../human'

// Import for internal use
import {
  HumanChannelError,
  HumanNotificationFailedError,
  HumanValidationError,
  HumanTimeoutError,
  HumanCancelledError,
  buildNotificationPayload as buildPayload,
  sendWithRetry,
  interpolatePrompt as sharedInterpolatePrompt,
  generateTaskId as sharedGenerateTaskId,
  validateResponse as sharedValidateResponse,
  validateForm as sharedValidateForm,
  validateSchema as sharedValidateSchema,
  executeApprovalWorkflow as sharedExecuteApprovalWorkflow,
  buildEscalatedTask,
  hasEscalation,
  createTimeoutDefaultResponse,
  createTimeoutPromise,
  createAbortPromise,
  type ChannelConfig,
  type HumanNotificationPayload,
  type HumanResponse,
  type FormDefinition,
  type ApprovalWorkflow,
  type EscalationConfig,
  type ValidationSchema,
  type CustomValidator,
  type WorkflowContext,
} from '../human'

// Graph storage imports for unified state persistence
import {
  GraphHumanStore,
  type HumanStore,
  type HumanRequestType,
  type HumanRequestStatus,
  type CreateHumanRequestInput,
  type CompleteRequestInput,
} from '../human/graph-store'

import type { GraphStore } from '../../db/graph/types'

// ============================================================================
// TYPE RE-EXPORTS
// ============================================================================

// Re-export types from shared modules for backward compatibility
export type { FormFieldDefinition, FormDefinition } from '../human/channels'
export type { ChannelConfig, HumanNotificationPayload as NotificationPayload, HumanResponse } from '../human/channels'
export type { ApprovalWorkflow, ApprovalLevel, EscalationConfig } from '../human/workflows'

// ============================================================================
// TYPE DEFINITIONS (Executor-specific)
// ============================================================================

export interface HumanContext {
  taskId: string
  invocationId: string
  task: TaskDefinition
  channel: ChannelConfig
  state: {
    get: <T>(key: string) => Promise<T | null>
    set: <T>(key: string, value: T) => Promise<void>
    delete: (key: string) => Promise<boolean>
  }
  log: {
    debug: (message: string, data?: unknown) => void
    info: (message: string, data?: unknown) => void
    warn: (message: string, data?: unknown) => void
    error: (message: string, data?: unknown) => void
  }
  emit: (event: string, data: unknown) => Promise<void>
  signal: AbortSignal
}

export interface HumanResult {
  success: boolean
  response?: HumanResponse
  error?: Error
  taskId: string
  duration: number
  respondedBy?: string
  respondedAt?: Date
  channel: string
  escalated?: boolean
  escalationLevel?: number
  metrics: {
    notificationsSent?: number
    retries?: number
    waitTime?: number
    primaryChannelFailed?: boolean
  }
}

export interface ApprovalLevel {
  name: string
  users: string[]
}

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

export interface EscalationConfig {
  timeout: number
  to: string
  channelOptions?: Record<string, unknown>
  next?: EscalationConfig
}

export interface TaskDefinition {
  prompt: string | ((input: unknown) => string)
  channel: string | string[]
  timeout: number
  input?: unknown
  actions?: Array<string | { value: string; label: string; style?: 'primary' | 'danger' | 'default' }>
  form?: FormDefinition
  channelOptions?: Record<string, unknown>
  updateOnResponse?: boolean
  defaultOnTimeout?: { action: string; reason: string }
  escalation?: EscalationConfig
  reminder?: { before: number; message: string }
  approval?: ApprovalWorkflow
  delivery?: { maxRetries: number; retryDelay: number; backoff?: 'fixed' | 'exponential' }
  fallbackChannel?: string
  confirmDelivery?: boolean
  responseSchema?: Record<string, unknown>
  validateResponse?: (response: HumanResponse, context?: HumanContext) => boolean | string | Promise<boolean | string>
  transformResponse?: (response: HumanResponse) => HumanResponse
  applyDefaults?: boolean
  signal?: AbortSignal
  onSend?: (payload: NotificationPayload) => NotificationPayload | void
  onResponse?: (response: HumanResponse) => HumanResponse | void
}

export interface ExecutionOptions {
  taskId?: string
}

// ============================================================================
// DURABLE OBJECT STATE INTERFACE
// ============================================================================

interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

// ============================================================================
// NOTIFICATION SERVICE INTERFACE
// ============================================================================

interface NotificationService {
  send: (params: unknown) => Promise<{ messageId: string; delivered: boolean }>
  waitForResponse: (params: unknown) => Promise<HumanResponse>
  getDeliveryStatus: (messageId: string) => Promise<{ status: string; error?: string }>
  cancelPending: () => Promise<{ cancelled: boolean }>
}

// ============================================================================
// EXECUTOR OPTIONS
// ============================================================================

interface HumanFunctionExecutorOptions {
  state: DurableObjectState
  env: Record<string, string>
  channels: Record<string, ChannelConfig>
  notificationService: NotificationService
  onEvent?: (event: string, data: unknown) => void | Promise<void>
  /**
   * Optional GraphStore for unified state persistence.
   * When provided, state will be stored as Things in the graph model,
   * enabling rich querying and relationship-based audit trails.
   *
   * If not provided, falls back to DO storage for backward compatibility.
   */
  graphStore?: GraphStore
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Use shared implementations from lib/human
const generateTaskId = sharedGenerateTaskId
const interpolatePrompt = sharedInterpolatePrompt

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// HUMAN FUNCTION EXECUTOR
// ============================================================================

export class HumanFunctionExecutor {
  private state: DurableObjectState
  private env: Record<string, string>
  private channels: Record<string, ChannelConfig>
  private notificationService: NotificationService
  private onEvent?: (event: string, data: unknown) => void | Promise<void>
  private graphStore?: GraphStore
  private humanStore?: GraphHumanStore

  constructor(options: HumanFunctionExecutorOptions) {
    this.state = options.state
    this.env = options.env
    this.channels = options.channels
    this.notificationService = options.notificationService
    this.onEvent = options.onEvent
    this.graphStore = options.graphStore
    // Initialize GraphHumanStore if graphStore is provided
    if (this.graphStore) {
      this.humanStore = new GraphHumanStore(this.graphStore)
    }
  }

  /**
   * Check if graph-based storage is enabled.
   * When enabled, state is persisted to GraphHumanStore instead of DO storage.
   */
  get isGraphStorageEnabled(): boolean {
    return !!this.humanStore
  }

  // ==========================================================================
  // GRAPH-BASED STATE PERSISTENCE METHODS
  // ==========================================================================

  /**
   * Persist task state to either GraphHumanStore or DO storage.
   * When graphStore is configured, creates a TaskRequest Thing with status and metadata.
   */
  private async persistTaskState(
    taskId: string,
    status: HumanRequestStatus,
    task: TaskDefinition,
    extra?: Record<string, unknown>
  ): Promise<void> {
    if (this.humanStore) {
      // Use graph storage - create or update task request as a Thing
      try {
        const existing = await this.humanStore.get(taskId)
        if (existing) {
          // Update existing request - use cancel for cancelled/timeout states
          if (status === 'timeout') {
            // Graph store doesn't have a direct timeout method, but we can handle via storage
            await this.state.storage.put(`task:${taskId}`, { status, ...extra })
          } else if (status === 'cancelled') {
            await this.humanStore.cancel(taskId, extra?.reason as string)
          }
        } else {
          // Create new task request in graph
          const message = typeof task.prompt === 'function'
            ? task.prompt(task.input)
            : interpolatePrompt(task.prompt, (task.input as Record<string, unknown>) || {})

          await this.humanStore.create({
            type: 'task' as HumanRequestType,
            title: message.substring(0, 100),
            description: message,
            channel: Array.isArray(task.channel) ? task.channel[0] : task.channel,
            timeout: task.timeout,
            metadata: {
              taskId,
              status,
              input: task.input,
              actions: task.actions,
              ...extra,
            },
          })
        }
      } catch {
        // Fall back to DO storage on graph errors
        await this.state.storage.put(`task:${taskId}`, { status, ...extra })
      }
    } else {
      // Use DO storage (backward compatible)
      await this.state.storage.put(`task:${taskId}`, { status, ...extra })
    }
  }

  /**
   * Persist notification info to either GraphHumanStore or DO storage.
   * When graphStore is configured, stores as metadata on the task request.
   */
  private async persistNotificationInfo(
    taskId: string,
    messageId: string,
    channelName: string
  ): Promise<void> {
    // Always persist to DO storage for quick lookup
    await this.state.storage.put(`notification:${taskId}`, {
      messageId,
      channel: channelName,
    })

    // Graph storage is handled via task metadata during creation
  }

  /**
   * Persist audit log entry to either GraphHumanStore or DO storage.
   * When graphStore is configured, creates a 'responded' relationship with audit data.
   */
  private async persistAuditLog(
    taskId: string,
    response: HumanResponse
  ): Promise<void> {
    const auditData = {
      taskId,
      action: response.action,
      userId: response.userId,
      comment: response.data?.comment || response.data?.reason,
      timestamp: response.timestamp,
    }

    if (this.humanStore) {
      // Use graph storage - complete the request which creates the responded relationship
      try {
        await this.humanStore.complete(taskId, {
          respondedBy: response.userId,
          reason: (response.data?.comment || response.data?.reason) as string | undefined,
          // Map action to appropriate response type
          approved: response.action === 'approve',
          completed: response.action !== 'reject',
        })
      } catch {
        // Fall back to DO storage on graph errors (e.g., request doesn't exist in graph)
        await this.state.storage.put(`audit:${taskId}`, auditData)
      }
    } else {
      // Use DO storage (backward compatible)
      await this.state.storage.put(`audit:${taskId}`, auditData)
    }
  }

  async execute(task: TaskDefinition): Promise<HumanResult> {
    const startTime = Date.now()
    const taskId = generateTaskId()
    const metrics: HumanResult['metrics'] = {
      notificationsSent: 0,
      retries: 0,
      waitTime: 0,
    }

    // Check if already cancelled
    if (task.signal?.aborted) {
      return {
        success: false,
        error: new HumanCancelledError('Task cancelled before execution'),
        taskId,
        duration: 0,
        channel: Array.isArray(task.channel) ? task.channel[0]! : task.channel,
        metrics,
      }
    }

    // Validate channel exists before proceeding
    const channelNames = Array.isArray(task.channel) ? task.channel : [task.channel]
    for (const channelName of channelNames) {
      if (!this.channels[channelName]) {
        throw new HumanChannelError(`Unknown channel: ${channelName}`)
      }
    }

    // Build context
    const context = this.buildContext(taskId, task)

    // Emit started event
    await this.emit('human.started', { taskId, channel: task.channel })

    try {
      // Handle approval workflows
      if (task.approval) {
        return await this.executeApprovalWorkflow(task, taskId, startTime, metrics, context)
      }

      // Handle multi-channel
      if (Array.isArray(task.channel)) {
        return await this.executeMultiChannel(task, taskId, startTime, metrics, context)
      }

      // Single channel execution
      return await this.executeSingleChannel(task, taskId, startTime, metrics, context)
    } catch (error) {
      const duration = Date.now() - startTime
      const err = error instanceof Error ? error : new Error(String(error))

      await this.emit('human.error', { taskId, error: err.message })

      // Persist error state - use direct DO storage since 'failed' is not a graph status
      // When graphStore is enabled, errors are still tracked but not as graph Things
      await this.state.storage.put(`task:${taskId}`, {
        status: 'failed',
        error: err.message,
      })

      return {
        success: false,
        error: err instanceof HumanChannelError || err instanceof HumanTimeoutError ||
               err instanceof HumanValidationError || err instanceof HumanCancelledError ||
               err instanceof HumanNotificationFailedError
          ? err
          : new HumanChannelError(err.message),
        taskId,
        duration,
        channel: Array.isArray(task.channel) ? task.channel[0]! : task.channel,
        metrics,
      }
    }
  }

  private async executeSingleChannel(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    context: HumanContext,
    escalationLevel: number = 0,
    useFallback: boolean = false
  ): Promise<HumanResult> {
    let channelName = useFallback && task.fallbackChannel ? task.fallbackChannel : (task.channel as string)
    const channel = this.channels[channelName]

    if (!channel) {
      throw new HumanChannelError(`Unknown channel: ${channelName}`)
    }

    // Resolve prompt
    const message = typeof task.prompt === 'function'
      ? task.prompt(task.input)
      : interpolatePrompt(task.prompt, (task.input as Record<string, unknown>) || {})

    // Build notification payload
    let payload = this.buildNotificationPayload(task, message, channelName)

    // Call onSend callback if provided
    if (task.onSend) {
      const modified = task.onSend(payload)
      if (modified) {
        payload = modified
      }
    }

    // Send notification with retries
    let messageId: string
    let retries = 0
    const maxRetries = task.delivery?.maxRetries ?? 1
    const retryDelay = task.delivery?.retryDelay ?? 1000
    const backoff = task.delivery?.backoff ?? 'fixed'

    while (true) {
      try {
        const sendResult = await channel.send(payload)
        messageId = sendResult.messageId
        metrics.notificationsSent = (metrics.notificationsSent || 0) + 1

        // Store notification info (uses helper for potential graph integration)
        await this.persistNotificationInfo(taskId, messageId, channelName)

        await this.emit('human.notification.sent', { channel: channelName, messageId })

        // Confirm delivery if required
        if (task.confirmDelivery && !sendResult.delivered) {
          const status = await this.notificationService.getDeliveryStatus(messageId)
          if (status.status === 'failed') {
            throw new HumanNotificationFailedError(`Delivery failed: ${status.error}`)
          }
        }

        break
      } catch (error) {
        retries++
        metrics.retries = retries

        if (retries >= maxRetries) {
          // Try fallback channel if available
          if (!useFallback && task.fallbackChannel && this.channels[task.fallbackChannel]) {
            metrics.primaryChannelFailed = true
            return this.executeSingleChannel(task, taskId, startTime, metrics, context, escalationLevel, true)
          }
          // HumanNotificationFailedError if delivery config specified (retry logic), otherwise HumanChannelError
          if (task.delivery) {
            throw new HumanNotificationFailedError(`Failed to send notification after ${retries} attempts`)
          } else {
            throw new HumanChannelError(`Failed to send: Channel unavailable`)
          }
        }

        const delay = backoff === 'exponential' ? retryDelay * Math.pow(2, retries - 1) : retryDelay
        await sleep(delay)
      }
    }

    // Set up reminder if configured
    let reminderTimeout: ReturnType<typeof setTimeout> | undefined
    if (task.reminder) {
      const reminderTime = task.timeout - task.reminder.before
      if (reminderTime > 0) {
        reminderTimeout = setTimeout(async () => {
          const reminderPayload = { ...payload, message: task.reminder!.message }
          await channel.send(reminderPayload)
        }, reminderTime)
      }
    }

    // Set up cancellation listener
    let cancelled = false
    const abortHandler = () => {
      cancelled = true
    }
    task.signal?.addEventListener('abort', abortHandler)

    // Wait for response with timeout
    const waitStart = Date.now()
    try {
      const response = await Promise.race([
        channel.waitForResponse({ timeout: task.timeout }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new HumanTimeoutError(`Timeout after ${task.timeout}ms`)), task.timeout)
        }),
        new Promise<never>((_, reject) => {
          if (task.signal) {
            task.signal.addEventListener('abort', () => {
              this.notificationService.cancelPending()
              reject(new HumanCancelledError('Task cancelled'))
            })
          }
        }),
      ])

      if (cancelled) {
        await this.notificationService.cancelPending()
        throw new HumanCancelledError('Task cancelled')
      }

      if (reminderTimeout) clearTimeout(reminderTimeout)
      task.signal?.removeEventListener('abort', abortHandler)

      const waitTime = Date.now() - waitStart
      metrics.waitTime = waitTime

      await this.emit('human.response.received', { action: response.action, userId: response.userId })

      // Apply onResponse callback
      let processedResponse = response
      if (task.onResponse) {
        const modified = task.onResponse(response)
        if (modified) {
          processedResponse = modified
        }
      }

      // Apply transformResponse
      if (task.transformResponse) {
        processedResponse = task.transformResponse(processedResponse)
      }

      // Validate action
      if (task.actions && task.actions.length > 0) {
        const validActions = task.actions.map(a => typeof a === 'string' ? a : a.value)
        if (!validActions.includes(processedResponse.action)) {
          const validationError = new HumanValidationError(`Invalid action: ${processedResponse.action}. Expected one of: ${validActions.join(', ')}`)
          return {
            success: false,
            error: validationError,
            taskId,
            duration: Date.now() - startTime,
            channel: useFallback && task.fallbackChannel ? task.fallbackChannel : channelName,
            metrics,
          }
        }
      }

      // Validate form
      if (task.form) {
        const validationResult = await this.validateForm(task.form, processedResponse.data, task.applyDefaults)
        if (!validationResult.valid) {
          return {
            success: false,
            error: validationResult.error!,
            taskId,
            duration: Date.now() - startTime,
            channel: useFallback && task.fallbackChannel ? task.fallbackChannel : channelName,
            metrics,
          }
        }
        if (validationResult.data) {
          processedResponse.data = validationResult.data
        }
      }

      // Validate with schema
      if (task.responseSchema) {
        const schemaResult = this.validateSchema(task.responseSchema, processedResponse.data)
        if (!schemaResult.valid) {
          return {
            success: false,
            error: new HumanValidationError(schemaResult.error!),
            taskId,
            duration: Date.now() - startTime,
            channel: useFallback && task.fallbackChannel ? task.fallbackChannel : channelName,
            metrics,
          }
        }
      }

      // Custom validation
      if (task.validateResponse) {
        // Only pass context if the validator function explicitly accepts 2 args
        const validResult = task.validateResponse.length > 1
          ? await task.validateResponse(processedResponse, context)
          : await task.validateResponse(processedResponse)
        if (validResult !== true) {
          const errorMessage = typeof validResult === 'string' ? validResult : 'Validation failed'
          return {
            success: false,
            error: new HumanValidationError(errorMessage),
            taskId,
            duration: Date.now() - startTime,
            channel: useFallback && task.fallbackChannel ? task.fallbackChannel : channelName,
            metrics,
          }
        }
      }

      // Update message if configured
      if (task.updateOnResponse && channel.updateMessage) {
        await channel.updateMessage(messageId!, {
          message: `Request ${processedResponse.action}d by ${processedResponse.userId}`,
        })
      }

      // Store audit log (uses GraphHumanStore if configured for relationship-based audit trail)
      await this.persistAuditLog(taskId, processedResponse)

      await this.emit('human.decision', { action: processedResponse.action, userId: processedResponse.userId })

      const duration = Date.now() - startTime
      await this.emit('human.completed', { success: true, duration })

      return {
        success: true,
        response: processedResponse,
        taskId,
        duration,
        respondedBy: processedResponse.userId,
        respondedAt: processedResponse.timestamp,
        channel: useFallback && task.fallbackChannel ? task.fallbackChannel : channelName,
        escalated: escalationLevel > 0,
        escalationLevel: escalationLevel > 0 ? escalationLevel : undefined,
        metrics,
      }
    } catch (error) {
      if (reminderTimeout) clearTimeout(reminderTimeout)
      task.signal?.removeEventListener('abort', abortHandler)

      if (error instanceof HumanCancelledError) {
        return {
          success: false,
          error,
          taskId,
          duration: Date.now() - startTime,
          channel: channelName,
          metrics,
        }
      }

      if (error instanceof HumanTimeoutError) {
        metrics.waitTime = Date.now() - waitStart

        // Persist timeout state (uses GraphHumanStore if configured)
        await this.persistTaskState(taskId, 'timeout', task, {
          notificationSent: true,
          messageId: messageId!,
        })

        await this.emit('human.timeout', { taskId, timeout: task.timeout })

        // Handle default on timeout
        if (task.defaultOnTimeout) {
          const defaultResponse: HumanResponse = {
            action: task.defaultOnTimeout.action,
            userId: 'system',
            timestamp: new Date(),
            data: { reason: task.defaultOnTimeout.reason },
            isDefault: true,
          }

          return {
            success: true,
            response: defaultResponse,
            taskId,
            duration: Date.now() - startTime,
            channel: channelName,
            metrics,
          }
        }

        // Handle escalation
        if (task.escalation) {
          await this.emit('human.escalated', {
            fromChannel: channelName,
            toChannel: task.escalation.to,
            level: escalationLevel + 1,
          })

          const escalatedTask: TaskDefinition = {
            ...task,
            channel: task.escalation.to,
            timeout: task.escalation.next?.timeout || task.escalation.timeout,
            channelOptions: {
              ...task.channelOptions,
              [task.escalation.to]: task.escalation.channelOptions,
            },
            escalation: task.escalation.next,
          }

          return this.executeSingleChannel(
            escalatedTask,
            taskId,
            startTime,
            metrics,
            context,
            escalationLevel + 1
          )
        }

        return {
          success: false,
          error,
          taskId,
          duration: Date.now() - startTime,
          channel: channelName,
          escalated: escalationLevel > 0,
          metrics,
        }
      }

      throw error
    }
  }

  private async executeMultiChannel(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    context: HumanContext
  ): Promise<HumanResult> {
    const channels = task.channel as string[]

    // Resolve prompt once
    const message = typeof task.prompt === 'function'
      ? task.prompt(task.input)
      : interpolatePrompt(task.prompt, (task.input as Record<string, unknown>) || {})

    // Send to all channels
    const sendPromises = channels.map(async (channelName) => {
      const channel = this.channels[channelName]
      if (!channel) {
        throw new HumanChannelError(`Unknown channel: ${channelName}`)
      }

      const channelOptions = (task.channelOptions as Record<string, unknown>)?.[channelName] || {}
      const payload = this.buildNotificationPayload(
        { ...task, channelOptions: channelOptions as Record<string, unknown> },
        message,
        channelName
      )

      await channel.send(payload)
      metrics.notificationsSent = (metrics.notificationsSent || 0) + 1
    })

    await Promise.all(sendPromises)

    // Race for first response
    const responsePromises = channels.map(async (channelName) => {
      const channel = this.channels[channelName]!
      const response = await channel.waitForResponse({ timeout: task.timeout })
      return { channelName, response }
    })

    const { channelName: respondingChannel, response } = await Promise.race(responsePromises)

    // Cancel pending notifications
    await this.notificationService.cancelPending()

    const waitTime = Date.now() - startTime
    metrics.waitTime = waitTime

    return {
      success: true,
      response,
      taskId,
      duration: Date.now() - startTime,
      respondedBy: response.userId,
      respondedAt: response.timestamp,
      channel: respondingChannel,
      metrics,
    }
  }

  /**
   * Execute approval workflow using shared implementation from lib/human/workflows.
   *
   * This method creates the WorkflowContext and delegates to the shared
   * executeApprovalWorkflow function, eliminating code duplication.
   */
  private async executeApprovalWorkflow(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    _context: HumanContext
  ): Promise<HumanResult> {
    const approval = task.approval!
    const channelName = task.channel as string
    const channel = this.channels[channelName]

    if (!channel) {
      throw new HumanChannelError(`Unknown channel: ${channelName}`)
    }

    const message = typeof task.prompt === 'function'
      ? task.prompt(task.input)
      : interpolatePrompt(task.prompt, (task.input as Record<string, unknown>) || {})

    // Build WorkflowContext for shared workflow functions
    const workflowContext: WorkflowContext = {
      channel,
      buildPayload: (msg: string, mentions?: string[]) => {
        const payload = this.buildNotificationPayload(task, msg, channelName)
        if (mentions) {
          payload.mentions = mentions
        }
        return payload
      },
      timeout: task.timeout,
      onNotificationSent: () => {
        metrics.notificationsSent = (metrics.notificationsSent || 0) + 1
      },
    }

    // Delegate to shared workflow executor
    const result = await sharedExecuteApprovalWorkflow(
      approval,
      workflowContext,
      message,
      task.input
    )

    // Convert workflow result to HumanResult
    return {
      success: true,
      response: {
        action: result.action,
        userId: result.approvals[result.approvals.length - 1]?.userId || '',
        timestamp: new Date(),
        data: {},
        approvals: result.approvals,
        approvalCount: result.approvalCount,
        rejectionCount: result.rejectionCount,
        rejectedBy: result.rejectedBy,
        rejectionLevel: result.rejectionLevel,
      },
      taskId,
      duration: Date.now() - startTime,
      channel: channelName,
      metrics,
    }
  }

  private buildNotificationPayload(
    task: TaskDefinition,
    message: string,
    channelName: string
  ): NotificationPayload {
    const channelOptions = task.channelOptions || {}
    const specificOptions = (channelOptions[channelName] as Record<string, unknown>) || channelOptions

    const payload: NotificationPayload = {
      message,
      channel: channelName,
    }

    // Add actions
    if (task.actions) {
      payload.actions = task.actions.map(action => {
        if (typeof action === 'string') {
          return { text: action, value: action }
        }
        return { text: action.label, value: action.value, style: action.style }
      })
    }

    // Add form
    if (task.form) {
      payload.form = task.form
    }

    // Add channel-specific options
    if (channelName === 'slack' || specificOptions.slackChannel) {
      if (specificOptions.slackChannel) {
        payload.channel = specificOptions.slackChannel as string
      }
      if (specificOptions.mentionUsers) {
        payload.mentions = specificOptions.mentionUsers as string[]
      }
      if (specificOptions.channel) {
        payload.channel = specificOptions.channel as string
      }
    }

    if (channelName === 'email') {
      if (specificOptions.to) {
        payload.to = specificOptions.to as string
      }
      if (specificOptions.subject) {
        payload.subject = specificOptions.subject as string
      }
      if (specificOptions.contentType) {
        payload.contentType = specificOptions.contentType as 'text' | 'html'
      }
      if (specificOptions.actionLinkBaseUrl && task.actions) {
        payload.actions = payload.actions?.map(action => ({
          ...action,
          url: `${specificOptions.actionLinkBaseUrl}/${action.value}`,
        }))
      }
    }

    if (channelName === 'in-app') {
      if (specificOptions.userId) {
        payload.userId = specificOptions.userId as string
      }
      if (specificOptions.priority) {
        payload.priority = specificOptions.priority as 'low' | 'normal' | 'high' | 'critical'
      }
      if (specificOptions.pushNotification !== undefined) {
        payload.pushNotification = specificOptions.pushNotification as boolean
      }
    }

    return payload
  }

  /**
   * Validate form data using shared implementation from lib/human/validation.
   * This eliminates code duplication with objects/Human.ts.
   */
  private async validateForm(
    form: FormDefinition,
    data: Record<string, unknown>,
    applyDefaults?: boolean
  ): Promise<{ valid: boolean; error?: HumanValidationError; data?: Record<string, unknown> }> {
    return sharedValidateForm(form, data, applyDefaults)
  }

  /**
   * Validate data against JSON schema using shared implementation from lib/human/validation.
   * This eliminates code duplication with objects/Human.ts.
   */
  private validateSchema(
    schema: Record<string, unknown>,
    data: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    return sharedValidateSchema(schema as ValidationSchema, data)
  }

  private buildContext(taskId: string, task: TaskDefinition): HumanContext {
    const channelName = Array.isArray(task.channel) ? task.channel[0]! : task.channel
    const channel = this.channels[channelName]

    return {
      taskId,
      invocationId: `inv-${Date.now()}`,
      task,
      channel: channel!,
      state: {
        get: async <T>(key: string) => (await this.state.storage.get(key)) as T | null,
        set: async <T>(key: string, value: T) => {
          await this.state.storage.put(key, value)
        },
        delete: async (key: string) => this.state.storage.delete(key),
      },
      log: {
        debug: (message: string, _data?: unknown) => console.debug(`[${taskId}] ${message}`),
        info: (message: string, _data?: unknown) => console.info(`[${taskId}] ${message}`),
        warn: (message: string, _data?: unknown) => console.warn(`[${taskId}] ${message}`),
        error: (message: string, _data?: unknown) => console.error(`[${taskId}] ${message}`),
      },
      emit: async (event: string, data: unknown) => {
        await this.emit(event, data)
      },
      signal: task.signal || new AbortController().signal,
    }
  }

  private async emit(event: string, data: unknown): Promise<void> {
    if (this.onEvent) {
      await this.onEvent(event, data)
    }
  }
}

export default HumanFunctionExecutor
