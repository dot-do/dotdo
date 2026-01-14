/**
 * @dotdo/emails - Email Service Types
 *
 * Type definitions for SendGrid and Resend API compatibility.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface EmailAddress {
  email: string
  name?: string
}

export interface EmailAttachment {
  content: string // Base64 encoded
  filename: string
  type?: string // MIME type
  disposition?: 'attachment' | 'inline'
  content_id?: string // For inline attachments
}

export interface EmailHeaders {
  [key: string]: string
}

// ============================================================================
// SendGrid-Compatible Types (POST /v3/mail/send)
// ============================================================================

export interface SendGridPersonalization {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  subject?: string
  headers?: EmailHeaders
  substitutions?: Record<string, string>
  dynamic_template_data?: Record<string, unknown>
  custom_args?: Record<string, string>
  send_at?: number
}

export interface SendGridContent {
  type: 'text/plain' | 'text/html' | string
  value: string
}

export interface SendGridASM {
  group_id: number
  groups_to_display?: number[]
}

export interface SendGridMailSettings {
  bypass_list_management?: { enable?: boolean }
  bypass_spam_management?: { enable?: boolean }
  bypass_bounce_management?: { enable?: boolean }
  footer?: { enable?: boolean; text?: string; html?: string }
  sandbox_mode?: { enable?: boolean }
}

export interface SendGridTrackingSettings {
  click_tracking?: { enable?: boolean; enable_text?: boolean }
  open_tracking?: { enable?: boolean; substitution_tag?: string }
  subscription_tracking?: {
    enable?: boolean
    text?: string
    html?: string
    substitution_tag?: string
  }
  ganalytics?: {
    enable?: boolean
    utm_source?: string
    utm_medium?: string
    utm_term?: string
    utm_content?: string
    utm_campaign?: string
  }
}

export interface SendGridMailRequest {
  personalizations: SendGridPersonalization[]
  from: EmailAddress
  reply_to?: EmailAddress
  reply_to_list?: EmailAddress[]
  subject?: string
  content?: SendGridContent[]
  attachments?: EmailAttachment[]
  template_id?: string
  headers?: EmailHeaders
  categories?: string[]
  custom_args?: Record<string, string>
  send_at?: number
  batch_id?: string
  asm?: SendGridASM
  ip_pool_name?: string
  mail_settings?: SendGridMailSettings
  tracking_settings?: SendGridTrackingSettings
}

export interface SendGridMailResponse {
  statusCode: 202 | 400 | 401 | 403 | 404 | 413 | 500
  headers?: {
    'x-message-id'?: string
  }
}

export interface SendGridError {
  message: string
  field?: string
  error_id?: string
  help?: string
}

export interface SendGridErrorResponse {
  errors: SendGridError[]
}

// ============================================================================
// Resend-Compatible Types (POST /emails)
// ============================================================================

export interface ResendEmailRequest {
  from: string
  to: string | string[]
  subject: string
  bcc?: string | string[]
  cc?: string | string[]
  reply_to?: string | string[]
  html?: string
  text?: string
  react?: unknown // React Email component (pre-compiled)
  headers?: EmailHeaders
  attachments?: ResendAttachment[]
  tags?: ResendTag[]
  scheduled_at?: string // ISO 8601 datetime
}

export interface ResendAttachment {
  content?: string // Base64 encoded
  filename: string
  path?: string // URL to fetch
  content_type?: string
}

export interface ResendTag {
  name: string
  value: string
}

export interface ResendEmailResponse {
  id: string
}

export interface ResendErrorResponse {
  statusCode: number
  message: string
  name: string
}

// ============================================================================
// Unified Internal Types
// ============================================================================

export interface EmailMessage {
  id: string
  from: EmailAddress
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  reply_to?: EmailAddress[]
  subject: string
  text?: string
  html?: string
  attachments?: EmailAttachment[]
  headers?: EmailHeaders
  tags?: Record<string, string>
  template_id?: string
  template_data?: Record<string, unknown>
  scheduled_at?: Date
  created_at: Date
  status: EmailStatus
  provider?: EmailProvider
  provider_message_id?: string
}

export type EmailStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'opened'
  | 'clicked'
  | 'complained'
  | 'unsubscribed'

export type EmailProvider = 'mailchannels' | 'resend' | 'sendgrid' | 'memory'

export interface EmailProviderConfig {
  provider: EmailProvider
  apiKey?: string
  domain?: string
  priority?: number // Lower = higher priority
  enabled?: boolean
}

// ============================================================================
// Webhook Types
// ============================================================================

export type WebhookEventType =
  | 'delivered'
  | 'bounced'
  | 'opened'
  | 'clicked'
  | 'complained'
  | 'unsubscribed'
  | 'failed'

export interface WebhookEvent {
  id: string
  type: WebhookEventType
  email_id: string
  recipient: string
  timestamp: Date
  metadata?: Record<string, unknown>
  // For click events
  url?: string
  // For bounce events
  bounce_type?: 'hard' | 'soft'
  bounce_reason?: string
}

export interface WebhookSubscription {
  id: string
  url: string
  events: WebhookEventType[]
  secret?: string
  enabled: boolean
  created_at: Date
}

// ============================================================================
// Template Types
// ============================================================================

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  html: string
  text?: string
  variables?: string[]
  created_at: Date
  updated_at: Date
}

// ============================================================================
// Agent Email Types
// ============================================================================

export interface AgentEmailConfig {
  agent_id: string
  email_address: string // e.g., priya@agents.startup.do
  display_name?: string
  enabled: boolean
  forward_to?: string[] // Forward inbound emails to these addresses
  auto_reply?: {
    enabled: boolean
    message?: string
  }
}

export interface InboundEmail {
  id: string
  from: EmailAddress
  to: string // Agent email address
  subject: string
  text?: string
  html?: string
  attachments?: EmailAttachment[]
  headers: EmailHeaders
  received_at: Date
  processed: boolean
  agent_id?: string
}
