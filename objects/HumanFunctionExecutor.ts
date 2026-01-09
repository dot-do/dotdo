/**
 * HumanFunctionExecutor
 *
 * Placeholder for HumanFunction execution engine.
 * This file exists only to allow tests to run and fail properly.
 * Implementation will be done in GREEN phase.
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
// PLACEHOLDER EXECUTOR CLASS
// ============================================================================

interface HumanFunctionExecutorOptions {
  state: DurableObjectState
  env: Record<string, string>
  channels: Record<string, ChannelConfig>
  notificationService: {
    send: (params: unknown) => Promise<{ messageId: string; delivered: boolean }>
    waitForResponse: (params: unknown) => Promise<HumanResponse>
    getDeliveryStatus: (messageId: string) => Promise<{ status: string; error?: string }>
    cancelPending: () => Promise<{ cancelled: boolean }>
  }
  onEvent?: (event: string, data: unknown) => void | Promise<void>
}

interface DurableObjectState {
  id: { toString: () => string }
  storage: {
    get: (key: string) => Promise<unknown>
    put: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<boolean>
    list: (options?: { prefix?: string }) => Promise<Map<string, unknown>>
  }
}

/**
 * HumanFunctionExecutor - Placeholder implementation
 *
 * This class exists only to make tests compile and run.
 * All tests should FAIL until GREEN phase implementation.
 */
export class HumanFunctionExecutor {
  constructor(_options: HumanFunctionExecutorOptions) {
    // Placeholder - no implementation
  }

  async execute(_task: TaskDefinition): Promise<HumanResult> {
    // Placeholder - always fails
    throw new Error('HumanFunctionExecutor not implemented')
  }
}

export default HumanFunctionExecutor
