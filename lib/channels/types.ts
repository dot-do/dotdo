/**
 * Shared Types for Channel Adapters
 *
 * Common interfaces and types used across all channel implementations.
 */

// ============================================================================
// ACTION TYPES
// ============================================================================

/**
 * Base action interface for interactive elements
 */
export interface Action {
  label: string
  value: string
}

/**
 * Extended action with style support (Slack, Discord)
 */
export interface StyledAction extends Action {
  style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link'
}

// ============================================================================
// NOTIFICATION PAYLOAD & RESULT
// ============================================================================

/**
 * Base notification payload interface
 * Each channel extends this with channel-specific properties
 */
export interface NotificationPayload {
  message: string
}

/**
 * Base notification result interface
 */
export interface NotificationResult {
  delivered: boolean
  messageId?: string
}

// ============================================================================
// HUMAN RESPONSE
// ============================================================================

/**
 * Response from a human interaction (button click, reaction, form submission)
 */
export interface HumanResponse {
  action: string
  userId: string
  requestId?: string
  data?: Record<string, unknown>
}

// ============================================================================
// CHANNEL CONFIGURATION
// ============================================================================

/**
 * Channel type identifier
 */
export type ChannelType = 'slack' | 'discord' | 'email' | 'mdxui'

/**
 * Base channel configuration
 */
export interface BaseChannelConfig {
  /** Optional channel type identifier */
  type?: ChannelType
}

/**
 * Slack channel configuration
 */
export interface SlackChannelConfig extends BaseChannelConfig {
  type?: 'slack'
  webhookUrl: string
  botToken?: string
}

/**
 * Discord channel configuration
 */
export interface DiscordChannelConfig extends BaseChannelConfig {
  type?: 'discord'
  webhookUrl: string
  botToken?: string
}

/**
 * Email provider types
 */
export type EmailProvider = 'sendgrid' | 'resend'

/**
 * Email channel configuration
 */
export interface EmailChannelConfig extends BaseChannelConfig {
  type?: 'email'
  provider: EmailProvider
  apiKey: string
  from: string
  tracking?: { opens?: boolean }
}

/**
 * MDXUI chat channel configuration
 */
export interface MDXUIChannelConfig extends BaseChannelConfig {
  type?: 'mdxui'
  env: {
    USER_DO: {
      idFromName(name: string): { toString(): string }
      get(id: { toString(): string }): {
        fetch(request: Request): Promise<Response>
      }
    }
  }
  realtime?: boolean
}

/**
 * Union of all channel configurations
 */
export type ChannelConfig =
  | SlackChannelConfig
  | DiscordChannelConfig
  | EmailChannelConfig
  | MDXUIChannelConfig

// ============================================================================
// FORM TYPES
// ============================================================================

/**
 * Base form field interface
 */
export interface FormField {
  name: string
  label: string
}

/**
 * Text input field
 */
export interface TextFormField extends FormField {
  type: 'text'
}

/**
 * Select dropdown field
 */
export interface SelectFormField extends FormField {
  type: 'select'
  options?: string[]
}

/**
 * Boolean/checkbox field
 */
export interface BooleanFormField extends FormField {
  type: 'boolean'
}

/**
 * Union of form field types
 */
export type FormFieldType = TextFormField | SelectFormField | BooleanFormField

// ============================================================================
// CHANNEL INTERFACE
// ============================================================================

/**
 * Channel interface that all channels should implement
 * Note: This is informational only - existing channels don't extend this
 * to maintain backwards compatibility
 */
export interface Channel<
  TPayload extends NotificationPayload = NotificationPayload,
  TResult extends NotificationResult = NotificationResult
> {
  /**
   * Send a notification through this channel
   */
  send(payload: TPayload): Promise<TResult>
}

/**
 * Channel with response capability
 */
export interface InteractiveChannel<
  TPayload extends NotificationPayload = NotificationPayload,
  TResult extends NotificationResult = NotificationResult,
  TResponse = HumanResponse
> extends Channel<TPayload, TResult> {
  /**
   * Wait for a human response (optional)
   */
  waitForResponse?(params: { timeout: number }): Promise<TResponse>
}
