/**
 * @dotdo/sendgrid - SendGrid SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for @sendgrid/mail that runs on Cloudflare Workers
 * using the emails.do backend service.
 *
 * Features:
 * - API-compatible with @sendgrid/mail npm package
 * - send() for single email
 * - sendMultiple() for batch sending
 * - Dynamic templates with templateId and dynamicTemplateData
 * - Personalizations (to, cc, bcc, custom headers, substitutions)
 * - Attachments
 * - Categories and custom args for tracking
 * - Scheduled sending
 *
 * @example Basic Usage
 * ```typescript
 * import sgMail from '@dotdo/sendgrid'
 *
 * sgMail.setApiKey(process.env.SENDGRID_API_KEY)
 *
 * await sgMail.send({
 *   to: 'recipient@example.com',
 *   from: 'sender@example.com',
 *   subject: 'Hello',
 *   text: 'Hello World',
 *   html: '<h1>Hello World</h1>',
 * })
 * ```
 *
 * @example Multiple Recipients
 * ```typescript
 * await sgMail.send({
 *   to: ['user1@example.com', 'user2@example.com'],
 *   from: 'sender@example.com',
 *   subject: 'Newsletter',
 *   html: '<p>Monthly update</p>',
 * })
 * ```
 *
 * @example Dynamic Templates
 * ```typescript
 * await sgMail.send({
 *   to: 'user@example.com',
 *   from: 'noreply@example.com',
 *   templateId: 'd-xxxxxxxxxxxxx',
 *   dynamicTemplateData: {
 *     name: 'John',
 *     orderNumber: '12345',
 *   },
 * })
 * ```
 *
 * @example With Attachments
 * ```typescript
 * await sgMail.send({
 *   to: 'user@example.com',
 *   from: 'sender@example.com',
 *   subject: 'Invoice',
 *   text: 'Please find your invoice attached.',
 *   attachments: [{
 *     content: Buffer.from('Invoice content').toString('base64'),
 *     filename: 'invoice.pdf',
 *     type: 'application/pdf',
 *     disposition: 'attachment',
 *   }],
 * })
 * ```
 *
 * @example Personalizations for Batch
 * ```typescript
 * await sgMail.send({
 *   personalizations: [
 *     { to: [{ email: 'user1@example.com' }], dynamicTemplateData: { name: 'User 1' } },
 *     { to: [{ email: 'user2@example.com' }], dynamicTemplateData: { name: 'User 2' } },
 *   ],
 *   from: 'noreply@example.com',
 *   templateId: 'd-welcome',
 * })
 * ```
 *
 * @example Send Multiple (isMultiple = true)
 * ```typescript
 * await sgMail.sendMultiple({
 *   to: ['user1@example.com', 'user2@example.com'],
 *   from: 'sender@example.com',
 *   subject: 'Personal message',
 *   text: 'This goes to each recipient separately.',
 * })
 * ```
 *
 * @see https://www.twilio.com/docs/sendgrid/api-reference/mail-send
 */

import {
  SendGridClient,
  convertSendGridToMessages,
  validateSendGridRequest,
  type SendGridClientConfig,
} from '../emails/sendgrid-compat'
import type {
  SendGridMailRequest,
  SendGridPersonalization,
  SendGridContent,
  SendGridASM,
  SendGridMailSettings,
  SendGridTrackingSettings,
  EmailAddress,
  EmailAttachment,
  EmailHeaders,
} from '../emails/types'

// ============================================================================
// Types - SDK-compatible interface
// ============================================================================

/**
 * Email address that can be a string or object with email/name
 */
export type EmailAddressInput = string | { email: string; name?: string }

/**
 * Attachment compatible with @sendgrid/mail format
 */
export interface AttachmentData {
  content: string // Base64 encoded content
  filename: string
  type?: string // MIME type
  disposition?: 'attachment' | 'inline'
  contentId?: string // For inline attachments (CID)
  content_id?: string // Alias for contentId
}

/**
 * Personalization for customizing email per recipient
 */
export interface PersonalizationData {
  to: EmailAddressInput | EmailAddressInput[]
  cc?: EmailAddressInput | EmailAddressInput[]
  bcc?: EmailAddressInput | EmailAddressInput[]
  subject?: string
  headers?: Record<string, string>
  substitutions?: Record<string, string>
  dynamicTemplateData?: Record<string, unknown>
  dynamic_template_data?: Record<string, unknown> // Alias
  customArgs?: Record<string, string>
  custom_args?: Record<string, string> // Alias
  sendAt?: number
  send_at?: number // Alias
}

/**
 * Mail data for sending email - SDK-compatible format
 */
export interface MailDataRequired {
  to?: EmailAddressInput | EmailAddressInput[]
  cc?: EmailAddressInput | EmailAddressInput[]
  bcc?: EmailAddressInput | EmailAddressInput[]
  from: EmailAddressInput
  replyTo?: EmailAddressInput
  replyToList?: EmailAddressInput[]
  reply_to?: EmailAddressInput // Alias
  reply_to_list?: EmailAddressInput[] // Alias
  subject?: string
  text?: string
  html?: string
  content?: Array<{ type: string; value: string }>
  templateId?: string
  template_id?: string // Alias
  dynamicTemplateData?: Record<string, unknown>
  dynamic_template_data?: Record<string, unknown> // Alias
  personalizations?: PersonalizationData[]
  attachments?: AttachmentData[]
  categories?: string[]
  headers?: Record<string, string>
  customArgs?: Record<string, string>
  custom_args?: Record<string, string> // Alias
  sendAt?: number
  send_at?: number // Alias
  batchId?: string
  batch_id?: string // Alias
  asm?: SendGridASM
  mailSettings?: SendGridMailSettings
  mail_settings?: SendGridMailSettings // Alias
  trackingSettings?: SendGridTrackingSettings
  tracking_settings?: SendGridTrackingSettings // Alias
  ipPoolName?: string
  ip_pool_name?: string // Alias
  substitutionWrappers?: [string, string]
  isMultiple?: boolean
}

/**
 * Response from send operation
 */
export interface ClientResponse {
  statusCode: number
  body: object
  headers: Record<string, string>
}

/**
 * Error response from SendGrid
 */
export class ResponseError extends Error {
  code: number
  response: {
    headers: Record<string, string>
    body: {
      errors: Array<{
        message: string
        field?: string
        help?: string
      }>
    }
  }

  constructor(message: string, code: number, body?: object) {
    super(message)
    this.name = 'ResponseError'
    this.code = code
    this.response = {
      headers: {},
      body: {
        errors: [{ message }],
        ...(body as object),
      },
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize email address input to EmailAddress object
 */
function normalizeEmailAddress(input: EmailAddressInput): EmailAddress {
  if (typeof input === 'string') {
    // Parse "Name <email@example.com>" format
    const match = input.match(/^(.+?)\s*<(.+)>$/)
    if (match) {
      return { email: match[2].trim(), name: match[1].trim() }
    }
    return { email: input }
  }
  return { email: input.email, name: input.name }
}

/**
 * Normalize array of email addresses
 */
function normalizeEmailAddresses(
  input: EmailAddressInput | EmailAddressInput[] | undefined
): EmailAddress[] | undefined {
  if (!input) return undefined
  const arr = Array.isArray(input) ? input : [input]
  return arr.map(normalizeEmailAddress)
}

/**
 * Convert SDK-style MailDataRequired to SendGrid API format
 */
function convertToSendGridRequest(data: MailDataRequired): SendGridMailRequest {
  // Build personalizations
  let personalizations: SendGridPersonalization[]

  if (data.personalizations && data.personalizations.length > 0) {
    // Use explicit personalizations
    personalizations = data.personalizations.map((p) => ({
      to: normalizeEmailAddresses(p.to) || [],
      cc: normalizeEmailAddresses(p.cc),
      bcc: normalizeEmailAddresses(p.bcc),
      subject: p.subject,
      headers: p.headers,
      substitutions: p.substitutions,
      dynamic_template_data: p.dynamicTemplateData || p.dynamic_template_data,
      custom_args: p.customArgs || p.custom_args,
      send_at: p.sendAt || p.send_at,
    }))
  } else if (data.to) {
    // Build single personalization from to/cc/bcc
    personalizations = [
      {
        to: normalizeEmailAddresses(data.to) || [],
        cc: normalizeEmailAddresses(data.cc),
        bcc: normalizeEmailAddresses(data.bcc),
        dynamic_template_data: data.dynamicTemplateData || data.dynamic_template_data,
        custom_args: data.customArgs || data.custom_args,
        send_at: data.sendAt || data.send_at,
      },
    ]
  } else {
    throw new ResponseError('The "to" field is required', 400)
  }

  // Build content array
  let content: SendGridContent[] | undefined

  if (data.content) {
    content = data.content
  } else if (data.text || data.html) {
    content = []
    if (data.text) {
      content.push({ type: 'text/plain', value: data.text })
    }
    if (data.html) {
      content.push({ type: 'text/html', value: data.html })
    }
  }

  // Convert attachments
  const attachments: EmailAttachment[] | undefined = data.attachments?.map((a) => ({
    content: a.content,
    filename: a.filename,
    type: a.type,
    disposition: a.disposition,
    content_id: a.contentId || a.content_id,
  }))

  // Build reply-to
  const replyTo = data.replyTo || data.reply_to
  const replyToList = data.replyToList || data.reply_to_list

  return {
    personalizations,
    from: normalizeEmailAddress(data.from),
    reply_to: replyTo ? normalizeEmailAddress(replyTo) : undefined,
    reply_to_list: replyToList ? normalizeEmailAddresses(replyToList) : undefined,
    subject: data.subject,
    content,
    attachments,
    template_id: data.templateId || data.template_id,
    headers: data.headers,
    categories: data.categories,
    custom_args: data.customArgs || data.custom_args,
    send_at: data.sendAt || data.send_at,
    batch_id: data.batchId || data.batch_id,
    asm: data.asm,
    mail_settings: data.mailSettings || data.mail_settings,
    tracking_settings: data.trackingSettings || data.tracking_settings,
    ip_pool_name: data.ipPoolName || data.ip_pool_name,
  }
}

/**
 * Split mail data into multiple requests when isMultiple is true
 */
function splitForMultipleSend(data: MailDataRequired): MailDataRequired[] {
  const recipients = normalizeEmailAddresses(data.to) || []
  return recipients.map((recipient) => ({
    ...data,
    to: recipient,
    personalizations: undefined,
  }))
}

// ============================================================================
// MailService Class - SDK-compatible
// ============================================================================

export type SendCallback = (error: Error | null, result?: [ClientResponse, object]) => void

/**
 * SendGrid Mail Service - compatible with @sendgrid/mail
 */
export class MailService {
  private apiKey: string | null = null
  private timeout: number = 60000
  private substitutionWrappers: [string, string] = ['{{', '}}']
  private client: SendGridClient | null = null

  /**
   * Set the SendGrid API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
    this.client = new SendGridClient({ apiKey })
  }

  /**
   * Set a custom client (for testing or custom configurations)
   */
  setClient(client: SendGridClient): void {
    this.client = client
  }

  /**
   * Set request timeout in milliseconds
   */
  setTimeout(timeout: number): void {
    this.timeout = timeout
  }

  /**
   * Set substitution wrappers for legacy templates
   */
  setSubstitutionWrappers(left: string, right: string): void {
    this.substitutionWrappers = [left, right]
  }

  /**
   * Get the current API key
   */
  getApiKey(): string | null {
    return this.apiKey
  }

  /**
   * Send an email
   *
   * @param data - Mail data to send
   * @param isMultiple - If true, sends separate email to each recipient
   * @param cb - Optional callback (Promise is also returned)
   */
  async send(
    data: MailDataRequired | MailDataRequired[],
    isMultiple?: boolean,
    cb?: SendCallback
  ): Promise<[ClientResponse, object]> {
    try {
      // Ensure we have a client
      if (!this.client) {
        if (!this.apiKey) {
          throw new ResponseError(
            'API key is required. Call setApiKey() before sending emails.',
            401
          )
        }
        this.client = new SendGridClient({ apiKey: this.apiKey })
      }

      // Handle array of mail data
      const dataArray = Array.isArray(data) ? data : [data]
      let allRequests: MailDataRequired[] = []

      for (const item of dataArray) {
        // Check if this item should be sent as multiple
        const shouldSplitMultiple = isMultiple || item.isMultiple
        if (shouldSplitMultiple && item.to && !item.personalizations) {
          allRequests = allRequests.concat(splitForMultipleSend(item))
        } else {
          allRequests.push(item)
        }
      }

      // Send all requests
      let lastMessageId = ''
      for (const mailData of allRequests) {
        const request = convertToSendGridRequest(mailData)

        // Validate request
        const validation = validateSendGridRequest(request)
        if (!validation.valid) {
          const errorMessage = validation.errors?.errors[0]?.message || 'Invalid request'
          throw new ResponseError(errorMessage, 400, validation.errors)
        }

        // Send via client
        const result = await this.client.send(request)

        if (result.statusCode !== 202) {
          throw new ResponseError('Failed to send email', result.statusCode)
        }

        lastMessageId = result.headers?.['x-message-id'] || crypto.randomUUID()
      }

      // Build response
      const response: ClientResponse = {
        statusCode: 202,
        body: {},
        headers: {
          'x-message-id': lastMessageId,
        },
      }

      const result: [ClientResponse, object] = [response, {}]

      if (cb) {
        cb(null, result)
      }

      return result
    } catch (error) {
      if (cb) {
        cb(error instanceof Error ? error : new Error(String(error)))
      }
      throw error
    }
  }

  /**
   * Send multiple emails - each recipient receives a separate email
   *
   * @param data - Mail data to send
   * @param cb - Optional callback
   */
  async sendMultiple(data: MailDataRequired, cb?: SendCallback): Promise<[ClientResponse, object]> {
    return this.send(data, true, cb)
  }
}

// ============================================================================
// Default Instance
// ============================================================================

const sgMail = new MailService()

// ============================================================================
// Exports
// ============================================================================

// Default export - the mail service instance
export default sgMail

// Named exports for the mail service
export { sgMail }

// Re-export types from emails for convenience
export type {
  SendGridMailRequest,
  SendGridPersonalization,
  SendGridContent,
  SendGridASM,
  SendGridMailSettings,
  SendGridTrackingSettings,
  EmailAddress,
  EmailAttachment,
  EmailHeaders,
}

// Re-export underlying client for advanced usage
export { SendGridClient, SendGridClientConfig }

// =============================================================================
// Extended API Exports
// =============================================================================

// Full-featured SendGrid client with all resources
export {
  SendGridClient as Client,
  SendGridError,
  MailResource,
  TemplatesResource,
  ContactsResource,
  ListsResource,
  StatsResource,
  type SendGridClientConfig as ClientConfig,
  type RequestOptions,
  type MailData,
  type MailSendResponse,
  type Template,
  type TemplateVersion,
  type TemplateCreateParams,
  type TemplateUpdateParams,
  type TemplateVersionCreateParams,
  type TemplateVersionUpdateParams,
  type TemplateListParams,
  type TemplateListResponse,
  type Contact,
  type ContactCreateParams,
  type ContactAddOptions,
  type ContactAddResponse,
  type ContactSearchParams,
  type ContactSearchResponse,
  type ContactCountResponse,
  type ContactExportResponse,
  type ContactDeleteParams,
  type ContactDeleteResponse,
  type ContactList,
  type ContactListCreateParams,
  type ContactListUpdateParams,
  type ContactListListResponse,
  type StatsParams,
  type CategoryStatsParams,
  type SubuserStatsParams,
  type EmailMetrics,
  type EmailStats,
} from './client'

// Durable client with exactly-once delivery
export {
  DurableSendGridClient,
  type DurableSendGridClientConfig,
  type DurableSendOptions,
  type EmailLog,
  type EmailLogStatus,
  type EmailTransaction,
} from './durable'

// Template management with local storage
export {
  TemplateManager,
  type TemplateManagerConfig,
  type RenderResult,
} from './templates'

// Contact management with local storage
export {
  ContactManager,
  ContactStorage,
  InMemoryContactStorage,
  KVContactStorage,
  type ContactManagerConfig,
  type JobResult,
  type ContactExportOptions,
} from './contacts'
