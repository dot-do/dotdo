/**
 * HumanFunctionExecutor
 *
 * Execution engine for HumanFunction - a function type that queues tasks for human input.
 * Supports multiple channels (slack, email, in-app), structured forms,
 * timeout handling, escalation, and approval workflows.
 */

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class HumanTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanTimeoutError'
  }
}

export class HumanChannelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanChannelError'
  }
}

export class HumanValidationError extends Error {
  fields?: string[]
  constructor(message: string, fields?: string[]) {
    super(message)
    this.name = 'HumanValidationError'
    this.fields = fields
  }
}

export class HumanEscalationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanEscalationError'
  }
}

export class HumanApprovalRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanApprovalRejectedError'
  }
}

export class HumanCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanCancelledError'
  }
}

export class HumanNotificationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanNotificationFailedError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
  validation?: (value: unknown) => boolean | string | Promise<boolean | string>
}

export interface FormDefinition {
  fields: FormFieldDefinition[]
}

export interface ChannelConfig {
  name: string
  type: 'slack' | 'email' | 'in-app' | 'custom'
  send: (payload: NotificationPayload) => Promise<{ messageId: string; delivered: boolean }>
  waitForResponse: (params: { timeout: number }) => Promise<HumanResponse>
  updateMessage?: (messageId: string, payload: Partial<NotificationPayload>) => Promise<{ success: boolean }>
}

export interface NotificationPayload {
  message: string
  channel?: string
  mentions?: string[]
  actions?: Array<{
    text: string
    value: string
    style?: 'primary' | 'danger' | 'default'
    url?: string
  }>
  form?: FormDefinition
  to?: string
  subject?: string
  contentType?: 'text' | 'html'
  userId?: string
  priority?: 'low' | 'normal' | 'high' | 'critical'
  pushNotification?: boolean
}

export interface HumanResponse {
  action: string
  userId: string
  timestamp: Date
  data: Record<string, unknown>
  isDefault?: boolean
  approvals?: Array<{ userId: string; action: string; timestamp: Date }>
  rejectedBy?: string
  rejectionLevel?: string
  approvalCount?: number
  rejectionCount?: number
}

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
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

function interpolatePrompt(prompt: string, input: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = input[key]
    return value !== undefined ? String(value) : `{{${key}}}`
  })
}

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

  constructor(options: HumanFunctionExecutorOptions) {
    this.state = options.state
    this.env = options.env
    this.channels = options.channels
    this.notificationService = options.notificationService
    this.onEvent = options.onEvent
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
        channel: Array.isArray(task.channel) ? task.channel[0] : task.channel,
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

      // Persist error state
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
        channel: Array.isArray(task.channel) ? task.channel[0] : task.channel,
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

        // Store notification info
        await this.state.storage.put(`notification:${taskId}`, {
          messageId,
          channel: channelName,
        })

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

      // Store audit log
      await this.state.storage.put(`audit:${taskId}`, {
        taskId,
        action: processedResponse.action,
        userId: processedResponse.userId,
        comment: processedResponse.data?.comment || processedResponse.data?.reason,
        timestamp: processedResponse.timestamp,
      })

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

        // Persist timeout state
        await this.state.storage.put(`task:${taskId}`, {
          status: 'timeout',
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
      const channel = this.channels[channelName]
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

  private async executeApprovalWorkflow(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    context: HumanContext
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

    if (approval.type === 'sequential') {
      return this.executeSequentialApproval(task, taskId, startTime, metrics, channel, message)
    } else if (approval.type === 'parallel') {
      return this.executeParallelApproval(task, taskId, startTime, metrics, channel, message)
    } else if (approval.type === 'conditional') {
      return this.executeConditionalApproval(task, taskId, startTime, metrics, channel, message)
    }

    throw new Error(`Unknown approval type: ${approval.type}`)
  }

  private async executeSequentialApproval(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    channel: ChannelConfig,
    message: string
  ): Promise<HumanResult> {
    const approval = task.approval!
    const levels = approval.levels || []
    const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []

    for (const level of levels) {
      const payload = this.buildNotificationPayload(task, message, channel.name)
      payload.mentions = level.users

      await channel.send(payload)
      metrics.notificationsSent = (metrics.notificationsSent || 0) + 1

      const response = await channel.waitForResponse({ timeout: task.timeout })

      approvals.push({
        userId: response.userId,
        action: response.action,
        timestamp: response.timestamp,
      })

      if (response.action === 'reject') {
        return {
          success: true,
          response: {
            ...response,
            action: 'reject',
            approvals,
            rejectedBy: response.userId,
            rejectionLevel: level.name,
          },
          taskId,
          duration: Date.now() - startTime,
          channel: channel.name,
          metrics,
        }
      }
    }

    return {
      success: true,
      response: {
        action: 'approve',
        userId: approvals[approvals.length - 1]?.userId || '',
        timestamp: new Date(),
        data: {},
        approvals,
      },
      taskId,
      duration: Date.now() - startTime,
      channel: channel.name,
      metrics,
    }
  }

  private async executeParallelApproval(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    channel: ChannelConfig,
    message: string
  ): Promise<HumanResult> {
    const approval = task.approval!
    const users = approval.users || []
    const requiredApprovals = approval.requiredApprovals || users.length
    const failFast = approval.failFast || false

    const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []
    let approvalCount = 0
    let rejectionCount = 0

    // Send to all users
    for (const _user of users) {
      const payload = this.buildNotificationPayload(task, message, channel.name)
      await channel.send(payload)
      metrics.notificationsSent = (metrics.notificationsSent || 0) + 1
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

      const response = await channel.waitForResponse({ timeout: task.timeout })
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
      success: true,
      response: {
        action: success ? 'approve' : 'reject',
        userId: approvals[approvals.length - 1]?.userId || '',
        timestamp: new Date(),
        data: {},
        approvals,
        approvalCount,
        rejectionCount,
      },
      taskId,
      duration: Date.now() - startTime,
      channel: channel.name,
      metrics,
    }
  }

  private async executeConditionalApproval(
    task: TaskDefinition,
    taskId: string,
    startTime: number,
    metrics: HumanResult['metrics'],
    channel: ChannelConfig,
    message: string
  ): Promise<HumanResult> {
    const approval = task.approval!
    const conditions = approval.conditions || []
    const input = task.input

    // Find matching condition
    const matchingCondition = conditions.find(c => c.when(input))
    if (!matchingCondition) {
      throw new Error('No matching approval condition found')
    }

    const users = matchingCondition.users
    const approvals: Array<{ userId: string; action: string; timestamp: Date }> = []

    if (matchingCondition.sequential) {
      // Sequential approval for matching users
      for (const user of users) {
        const payload = this.buildNotificationPayload(task, message, channel.name)
        payload.mentions = [user]
        await channel.send(payload)
        metrics.notificationsSent = (metrics.notificationsSent || 0) + 1

        const response = await channel.waitForResponse({ timeout: task.timeout })
        approvals.push({
          userId: response.userId,
          action: response.action,
          timestamp: response.timestamp,
        })

        if (response.action === 'reject') {
          return {
            success: true,
            response: {
              ...response,
              action: 'reject',
              approvals,
            },
            taskId,
            duration: Date.now() - startTime,
            channel: channel.name,
            metrics,
          }
        }
      }
    } else {
      // Single approval from any matching user
      const payload = this.buildNotificationPayload(task, message, channel.name)
      payload.mentions = users
      await channel.send(payload)
      metrics.notificationsSent = (metrics.notificationsSent || 0) + 1

      const response = await channel.waitForResponse({ timeout: task.timeout })
      approvals.push({
        userId: response.userId,
        action: response.action,
        timestamp: response.timestamp,
      })

      return {
        success: true,
        response: {
          ...response,
          approvals,
        },
        taskId,
        duration: Date.now() - startTime,
        channel: channel.name,
        metrics,
      }
    }

    return {
      success: true,
      response: {
        action: 'approve',
        userId: approvals[approvals.length - 1]?.userId || '',
        timestamp: new Date(),
        data: {},
        approvals,
      },
      taskId,
      duration: Date.now() - startTime,
      channel: channel.name,
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

  private async validateForm(
    form: FormDefinition,
    data: Record<string, unknown>,
    applyDefaults?: boolean
  ): Promise<{ valid: boolean; error?: HumanValidationError; data?: Record<string, unknown> }> {
    const errors: string[] = []
    const errorFields: string[] = []
    const processedData = { ...data }

    for (const field of form.fields) {
      let value = data[field.name]

      // Apply defaults if configured
      if (applyDefaults && value === undefined && field.default !== undefined) {
        processedData[field.name] = field.default
        value = field.default
      }

      // Required field validation
      if (field.required) {
        if (value === undefined || value === null || value === '') {
          errors.push(`required field ${field.name} is missing or empty`)
          errorFields.push(field.name)
          continue
        }
      }

      // Skip type validation if no value
      if (value === undefined || value === null) {
        continue
      }

      // Type validation
      switch (field.type) {
        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`Field '${field.name}' must be a number but got type ${typeof value}`)
            errorFields.push(field.name)
          }
          break

        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push(`Field '${field.name}' must be a boolean but got type ${typeof value}`)
            errorFields.push(field.name)
          }
          break

        case 'select':
          if (field.options && !field.options.includes(value as string)) {
            errors.push(`Field '${field.name}' has invalid option '${value}'. Must be one of: ${field.options.join(', ')}`)
            errorFields.push(field.name)
          }
          break

        case 'multiselect':
          if (!Array.isArray(value)) {
            errors.push(`Field '${field.name}' must be an array`)
            errorFields.push(field.name)
          } else if (field.options) {
            const invalidOptions = (value as string[]).filter(v => !field.options!.includes(v))
            if (invalidOptions.length > 0) {
              errors.push(`Field '${field.name}' has invalid options: ${invalidOptions.join(', ')}`)
              errorFields.push(field.name)
            }
          }
          break
      }

      // Custom validation
      if (field.validation && !errorFields.includes(field.name)) {
        const result = await field.validation(value)
        if (result !== true) {
          const message = typeof result === 'string' ? result : `Field '${field.name}' failed validation`
          errors.push(message)
          errorFields.push(field.name)
        }
      }
    }

    if (errors.length > 0) {
      return {
        valid: false,
        error: new HumanValidationError(errors.join('; '), errorFields),
      }
    }

    return { valid: true, data: processedData }
  }

  private validateSchema(
    schema: Record<string, unknown>,
    data: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    const properties = schema.properties as Record<string, { type: string }> | undefined
    const required = schema.required as string[] | undefined

    if (!properties) {
      return { valid: true }
    }

    // Check required fields
    if (required) {
      for (const field of required) {
        if (data[field] === undefined) {
          return { valid: false, error: `Required field '${field}' is missing` }
        }
      }
    }

    // Validate types
    for (const [field, fieldSchema] of Object.entries(properties)) {
      const value = data[field]
      if (value === undefined) continue

      const expectedType = fieldSchema.type
      const actualType = typeof value

      if (expectedType && actualType !== expectedType) {
        return { valid: false, error: `Field '${field}' should be ${expectedType} but got ${actualType}` }
      }
    }

    return { valid: true }
  }

  private buildContext(taskId: string, task: TaskDefinition): HumanContext {
    const channelName = Array.isArray(task.channel) ? task.channel[0] : task.channel
    const channel = this.channels[channelName]

    return {
      taskId,
      invocationId: `inv-${Date.now()}`,
      task,
      channel,
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
