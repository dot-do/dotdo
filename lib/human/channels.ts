/**
 * Human Channel Abstraction
 *
 * Unified channel interface for human notifications and responses.
 * Used by both HumanFunctionExecutor and Human DO to eliminate duplication.
 *
 * @module lib/human/channels
 */

import type {
  HumanResponse as BaseHumanResponse,
  NotificationPayload as BaseNotificationPayload,
  NotificationResult,
} from '../channels/types'

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when a channel operation fails
 */
export class HumanChannelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanChannelError'
  }
}

/**
 * Error thrown when notification delivery fails
 */
export class HumanNotificationFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanNotificationFailedError'
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Channel type identifiers
 */
export type HumanChannelType = 'slack' | 'email' | 'in-app' | 'sms' | 'discord' | 'webhook' | 'custom'

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical'

/**
 * Form field types for structured input
 */
export interface FormFieldDefinition {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect'
  label: string
  required?: boolean
  options?: string[]
  default?: unknown
  validation?: (value: unknown) => boolean | string | Promise<boolean | string>
}

/**
 * Form definition for structured human input
 */
export interface FormDefinition {
  fields: FormFieldDefinition[]
}

/**
 * Action button for notifications
 */
export interface NotificationAction {
  text: string
  value: string
  style?: 'primary' | 'danger' | 'default'
  url?: string
}

/**
 * Extended notification payload for human notifications
 */
export interface HumanNotificationPayload extends BaseNotificationPayload {
  channel?: string
  mentions?: string[]
  actions?: NotificationAction[]
  form?: FormDefinition
  to?: string
  subject?: string
  contentType?: 'text' | 'html'
  userId?: string
  priority?: NotificationPriority
  pushNotification?: boolean
  requestId?: string
}

/**
 * Extended human response with approval workflow support
 */
export interface HumanResponse extends BaseHumanResponse {
  timestamp: Date
  data: Record<string, unknown>
  isDefault?: boolean
  approvals?: Array<{ userId: string; action: string; timestamp: Date }>
  rejectedBy?: string
  rejectionLevel?: string
  approvalCount?: number
  rejectionCount?: number
}

/**
 * Channel send result
 */
export interface ChannelSendResult extends NotificationResult {
  messageId: string
}

/**
 * Channel configuration interface
 */
export interface ChannelConfig {
  name: string
  type: HumanChannelType
  send: (payload: HumanNotificationPayload) => Promise<ChannelSendResult>
  waitForResponse: (params: { timeout: number }) => Promise<HumanResponse>
  updateMessage?: (messageId: string, payload: Partial<HumanNotificationPayload>) => Promise<{ success: boolean }>
}

/**
 * Notification channel for Human DO (simpler interface)
 */
export interface NotificationChannel {
  type: 'email' | 'slack' | 'sms' | 'webhook'
  target: string
  priority: NotificationPriority
}

// ============================================================================
// CHANNEL REGISTRY
// ============================================================================

/**
 * Registry for managing channel configurations
 */
export class ChannelRegistry {
  private channels: Map<string, ChannelConfig> = new Map()

  /**
   * Register a channel
   */
  register(name: string, config: ChannelConfig): void {
    this.channels.set(name, config)
  }

  /**
   * Get a channel by name
   */
  get(name: string): ChannelConfig | undefined {
    return this.channels.get(name)
  }

  /**
   * Check if a channel exists
   */
  has(name: string): boolean {
    return this.channels.has(name)
  }

  /**
   * Get all channel names
   */
  names(): string[] {
    return Array.from(this.channels.keys())
  }

  /**
   * Validate that all specified channels exist
   */
  validateChannels(channelNames: string | string[]): void {
    const names = Array.isArray(channelNames) ? channelNames : [channelNames]
    for (const name of names) {
      if (!this.has(name)) {
        throw new HumanChannelError(`Unknown channel: ${name}`)
      }
    }
  }
}

// ============================================================================
// NOTIFICATION BUILDER
// ============================================================================

/**
 * Options for building notification payloads
 */
export interface NotificationBuildOptions {
  message: string
  channelName: string
  actions?: Array<string | { value: string; label: string; style?: 'primary' | 'danger' | 'default' }>
  form?: FormDefinition
  channelOptions?: Record<string, unknown>
  requestId?: string
}

/**
 * Build a notification payload from task options
 */
export function buildNotificationPayload(options: NotificationBuildOptions): HumanNotificationPayload {
  const { message, channelName, actions, form, channelOptions = {}, requestId } = options
  const specificOptions = (channelOptions[channelName] as Record<string, unknown>) || channelOptions

  const payload: HumanNotificationPayload = {
    message,
    channel: channelName,
    requestId,
  }

  // Add actions
  if (actions) {
    payload.actions = actions.map((action) => {
      if (typeof action === 'string') {
        return { text: action, value: action }
      }
      return { text: action.label, value: action.value, style: action.style }
    })
  }

  // Add form
  if (form) {
    payload.form = form
  }

  // Add channel-specific options
  applyChannelOptions(payload, channelName, specificOptions)

  return payload
}

/**
 * Apply channel-specific options to a payload
 */
function applyChannelOptions(
  payload: HumanNotificationPayload,
  channelName: string,
  options: Record<string, unknown>
): void {
  if (channelName === 'slack' || options.slackChannel) {
    if (options.slackChannel) {
      payload.channel = options.slackChannel as string
    }
    if (options.mentionUsers) {
      payload.mentions = options.mentionUsers as string[]
    }
    if (options.channel) {
      payload.channel = options.channel as string
    }
  }

  if (channelName === 'email') {
    if (options.to) {
      payload.to = options.to as string
    }
    if (options.subject) {
      payload.subject = options.subject as string
    }
    if (options.contentType) {
      payload.contentType = options.contentType as 'text' | 'html'
    }
    if (options.actionLinkBaseUrl && payload.actions) {
      payload.actions = payload.actions.map((action) => ({
        ...action,
        url: `${options.actionLinkBaseUrl}/${action.value}`,
      }))
    }
  }

  if (channelName === 'in-app') {
    if (options.userId) {
      payload.userId = options.userId as string
    }
    if (options.priority) {
      payload.priority = options.priority as NotificationPriority
    }
    if (options.pushNotification !== undefined) {
      payload.pushNotification = options.pushNotification as boolean
    }
  }
}

// ============================================================================
// DELIVERY SERVICE
// ============================================================================

/**
 * Delivery configuration
 */
export interface DeliveryConfig {
  maxRetries: number
  retryDelay: number
  backoff: 'fixed' | 'exponential'
}

/**
 * Default delivery configuration
 */
export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  maxRetries: 1,
  retryDelay: 1000,
  backoff: 'fixed',
}

/**
 * Send a notification with retry logic
 */
export async function sendWithRetry(
  channel: ChannelConfig,
  payload: HumanNotificationPayload,
  config: Partial<DeliveryConfig> = {}
): Promise<{ messageId: string; retries: number }> {
  const { maxRetries, retryDelay, backoff } = { ...DEFAULT_DELIVERY_CONFIG, ...config }

  let retries = 0

  while (true) {
    try {
      const result = await channel.send(payload)
      return { messageId: result.messageId, retries }
    } catch (error) {
      retries++

      if (retries >= maxRetries) {
        throw new HumanNotificationFailedError(
          `Failed to send notification after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`
        )
      }

      const delay = backoff === 'exponential' ? retryDelay * Math.pow(2, retries - 1) : retryDelay
      await sleep(delay)
    }
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Interpolate template variables in a prompt
 */
export function interpolatePrompt(prompt: string, input: Record<string, unknown>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = input[key]
    return value !== undefined ? String(value) : `{{${key}}}`
  })
}

/**
 * Generate a unique task/request ID
 */
export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

export default {
  ChannelRegistry,
  buildNotificationPayload,
  sendWithRetry,
  interpolatePrompt,
  generateTaskId,
}
