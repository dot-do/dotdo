/**
 * @dotdo/sendgrid - Type Definitions
 *
 * SendGrid API compatible types for email operations.
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

export type EmailProvider = 'mailchannels' | 'resend' | 'sendgrid'

export interface EmailProviderConfig {
  provider: EmailProvider
  apiKey?: string
  domain?: string
  priority?: number // Lower = higher priority
  enabled?: boolean
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
