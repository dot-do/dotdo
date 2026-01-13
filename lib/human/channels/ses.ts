/**
 * AWS SES Human Notification Channel
 *
 * Delivers human notifications via AWS SES (Simple Email Service).
 * AWS SES is the PRIMARY email mechanism for Human-in-the-Loop notifications
 * (preferred over SendGrid for cost and AWS integration).
 *
 * Features:
 * - SES v2 API with templates
 * - SNS integration for delivery tracking
 * - Bounce/complaint handling
 * - Rate limiting with exponential backoff
 * - S3 presigned URLs for attachments
 *
 * @example
 * ```typescript
 * const ses = new SESNotificationChannel({
 *   region: 'us-east-1',
 *   fromEmail: 'noreply@company.com',
 * })
 *
 * await ses.send({
 *   to: 'approver@company.com',
 *   requestId: 'req-123',
 *   message: 'Please approve the expense report',
 *   subject: '[Action Required] Expense Report',
 * })
 * ```
 *
 * @module lib/human/channels/ses
 */

import type {
  HumanNotificationChannel,
  ChannelType,
  NotificationPayload,
  SendResult,
  NotificationAction,
} from './index'
import { generateMessageId } from '../../channels/base'

// =============================================================================
// Types
// =============================================================================

/**
 * AWS credentials configuration
 */
export interface AWSCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

/**
 * SNS topic configuration for delivery tracking
 */
export interface SNSTopicConfig {
  bounce?: string
  complaint?: string
  delivery?: string
}

/**
 * SES Channel configuration
 */
export interface SESChannelConfig {
  /** AWS region (e.g., 'us-east-1') */
  region: string
  /** Verified sender email address */
  fromEmail: string
  /** AWS credentials (optional - uses IAM role if not provided) */
  credentials?: AWSCredentials
  /** SNS topic ARNs for delivery tracking */
  snsTopics?: SNSTopicConfig
  /** Base URL for action links */
  baseUrl?: string
  /** Custom fetch function (for testing) */
  fetch?: typeof fetch
}

/**
 * Extended notification payload for SES with recipient
 */
export interface SESNotificationPayload extends NotificationPayload {
  /** Recipient email address */
  to: string
}

/**
 * Delivery result with SES-specific fields
 */
export interface SESDeliveryResult extends SendResult {
  /** Custom headers that were set */
  headers?: Record<string, string>
  /** S3 presigned URLs for attachments */
  attachmentUrls?: string[]
  /** Template name if templated email */
  templateUsed?: string
}

/**
 * Delivery status from SNS tracking
 */
export interface SESDeliveryStatus {
  /** Current state of delivery */
  state: 'pending' | 'sent' | 'delivered' | 'bounced' | 'complained'
  /** Timestamp of status update */
  timestamp: string
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Task assignment payload
 */
export interface TaskAssignmentPayload {
  to: string
  taskId: string
  title: string
  description: string
  instructions?: string[]
  dueDate?: Date
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  assignedBy?: string
  attachments?: S3Attachment[]
}

/**
 * S3 attachment configuration
 */
export interface S3Attachment {
  filename: string
  s3Bucket: string
  s3Key: string
  contentType: string
  expiresIn?: number
}

/**
 * Escalation payload
 */
export interface EscalationPayload {
  to: string
  escalationId: string
  originalRequestId: string
  reason: string
  priority: 'high' | 'urgent'
  escalationLevel?: number
  escalationChain?: string[]
  currentLevel?: string
  slaDeadline?: Date
  slaWarning?: boolean
  timeRemaining?: string
  subject?: string
}

/**
 * Template email payload
 */
export interface TemplatePayload {
  to: string
  templateName: string
  templateData: Record<string, unknown>
  subject?: string
}

/**
 * Batch send options
 */
export interface BatchSendOptions {
  /** Emails per second rate limit */
  rateLimit?: number
  /** Retry on throttle errors */
  retryOnThrottle?: boolean
  /** Maximum retry attempts */
  maxRetries?: number
}

/**
 * Send options
 */
export interface SendOptions {
  /** Number of retry attempts */
  retries?: number
  /** Delay between retries in ms */
  retryDelay?: number
}

/**
 * SNS Bounce event structure
 */
export interface SNSBounceEvent {
  notificationType: 'Bounce'
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined'
    bounceSubType: string
    bouncedRecipients: Array<{
      emailAddress: string
      action?: string
      status?: string
      diagnosticCode?: string
    }>
    timestamp: string
    feedbackId: string
  }
  mail: {
    timestamp: string
    source: string
    messageId: string
    destination: string[]
  }
}

/**
 * SNS Complaint event structure
 */
export interface SNSComplaintEvent {
  notificationType: 'Complaint'
  complaint: {
    complainedRecipients: Array<{
      emailAddress: string
    }>
    timestamp: string
    feedbackId: string
    complaintFeedbackType?: string
  }
  mail: {
    timestamp: string
    source: string
    messageId: string
    destination: string[]
  }
}

/**
 * Bounce handling result
 */
export interface BounceHandleResult {
  processed: boolean
  bounceType: string
  action: 'suppress' | 'retry' | 'ignore'
  recipientsSuppressed?: string[]
  retryAfter?: Date
}

/**
 * Complaint handling result
 */
export interface ComplaintHandleResult {
  processed: boolean
  complaintType?: string
  recipientsSuppressed: string[]
}

/**
 * Delivery status options
 */
export interface DeliveryStatusOptions {
  timeout?: number
  pollInterval?: number
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = 'https://app.dotdo.dev'
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const SES_API_VERSION = '2019-09-27'

// =============================================================================
// Implementation
// =============================================================================

/**
 * AWS SES Human Notification Channel implementation
 */
export class SESNotificationChannel implements HumanNotificationChannel {
  readonly type: ChannelType = 'email'
  private config: SESChannelConfig
  private _fetch: typeof fetch
  private suppressionList: Set<string> = new Set()
  private deliveryStatuses: Map<string, SESDeliveryStatus> = new Map()

  constructor(config: SESChannelConfig) {
    // Validate configuration
    if (!config.region) {
      throw new Error('AWS region is required')
    }

    if (!EMAIL_REGEX.test(config.fromEmail)) {
      throw new Error('Invalid from email address')
    }

    this.config = config
    this._fetch = config.fetch ?? globalThis.fetch?.bind(globalThis)
  }

  /**
   * Send an email notification via SES
   */
  async send(
    payload: SESNotificationPayload | NotificationPayload,
    options?: SendOptions
  ): Promise<SESDeliveryResult> {
    const timestamp = new Date().toISOString()
    const sesPayload = payload as SESNotificationPayload
    const to = sesPayload.to

    if (!to) {
      return {
        delivered: false,
        error: 'No recipient email address provided',
        timestamp,
      }
    }

    // Validate recipient email
    if (!EMAIL_REGEX.test(to)) {
      return {
        delivered: false,
        error: 'Invalid recipient email address',
        timestamp,
      }
    }

    // Check suppression list
    if (this.suppressionList.has(to.toLowerCase())) {
      return {
        delivered: false,
        error: 'Recipient is in suppression list',
        timestamp,
      }
    }

    const subject = payload.subject || this.buildSubject(payload)
    const html = this.renderHtml(payload)
    const text = payload.message

    // Build headers for priority
    const headers: Record<string, string> = {}
    if (payload.priority === 'urgent') {
      headers['X-Priority'] = '1'
      headers['Importance'] = 'high'
    } else if (payload.priority === 'high') {
      headers['X-Priority'] = '2'
      headers['Importance'] = 'high'
    }

    try {
      const result = await this.sendViaSES(to, subject, html, text, headers, options)
      return {
        ...result,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      }
    } catch (error) {
      // Handle retries
      if (options?.retries && options.retries > 0) {
        await this.delay(options.retryDelay || 1000)
        return this.send(payload, {
          ...options,
          retries: options.retries - 1,
        })
      }

      return {
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  /**
   * Send email with SES template
   */
  async sendWithTemplate(payload: TemplatePayload): Promise<SESDeliveryResult> {
    const timestamp = new Date().toISOString()

    if (!payload.to || !EMAIL_REGEX.test(payload.to)) {
      return {
        delivered: false,
        error: 'Invalid recipient email address',
        timestamp,
      }
    }

    try {
      const endpoint = `https://email.${this.config.region}.amazonaws.com`
      const body = {
        Content: {
          Template: {
            TemplateName: payload.templateName,
            TemplateData: JSON.stringify(payload.templateData),
          },
        },
        Destination: {
          ToAddresses: [payload.to],
        },
        FromEmailAddress: this.config.fromEmail,
      }

      const response = await this.signAndFetch(
        `${endpoint}/v2/email/outbound-emails`,
        'POST',
        body
      )

      const data = await response.json() as { MessageId?: string }
      const isSuccess = response.status >= 200 && response.status < 300

      return {
        delivered: isSuccess,
        messageId: data.MessageId || generateMessageId(),
        templateUsed: payload.templateName,
        error: isSuccess ? undefined : `HTTP ${response.status}`,
        timestamp,
      }
    } catch (error) {
      return {
        delivered: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      }
    }
  }

  /**
   * Send task assignment email
   */
  async sendTaskAssignment(payload: TaskAssignmentPayload): Promise<SESDeliveryResult> {
    const timestamp = new Date().toISOString()

    // Generate presigned URLs for attachments
    const attachmentUrls: string[] = []
    if (payload.attachments && payload.attachments.length > 0) {
      for (const attachment of payload.attachments) {
        const url = await this.generatePresignedUrl(attachment)
        attachmentUrls.push(url)
      }
    }

    // Build instructions HTML
    const instructionsHtml = payload.instructions
      ? `<ol>${payload.instructions.map(i => `<li>${i}</li>`).join('')}</ol>`
      : ''

    // Build attachments HTML
    const attachmentsHtml = attachmentUrls.length > 0
      ? `<h3>Attachments</h3><ul>${payload.attachments!.map((a, i) =>
          `<li><a href="${attachmentUrls[i]}">${a.filename}</a></li>`
        ).join('')}</ul>`
      : ''

    const dueDateStr = payload.dueDate
      ? `<p><strong>Due:</strong> ${payload.dueDate.toLocaleDateString()}</p>`
      : ''

    const html = `
      <h1>${payload.title}</h1>
      <p>${payload.description}</p>
      ${instructionsHtml}
      ${dueDateStr}
      ${payload.assignedBy ? `<p><em>Assigned by: ${payload.assignedBy}</em></p>` : ''}
      ${attachmentsHtml}
    `

    const subject = payload.priority === 'urgent'
      ? `[URGENT] Task Assignment: ${payload.title}`
      : payload.priority === 'high'
      ? `[HIGH] Task Assignment: ${payload.title}`
      : `Task Assignment: ${payload.title}`

    const result = await this.send({
      to: payload.to,
      requestId: payload.taskId,
      message: payload.description,
      subject,
      priority: payload.priority,
    })

    return {
      ...result,
      attachmentUrls: attachmentUrls.length > 0 ? attachmentUrls : undefined,
    }
  }

  /**
   * Send escalation email with priority headers
   */
  async sendEscalation(payload: EscalationPayload): Promise<SESDeliveryResult> {
    const timestamp = new Date().toISOString()

    // Build escalation HTML
    const slaWarningHtml = payload.slaWarning && payload.timeRemaining
      ? `<p style="color: #ef4444; font-weight: bold;">Time Remaining: ${payload.timeRemaining}</p>`
      : ''

    const chainHtml = payload.escalationChain && payload.escalationChain.length > 0
      ? `<p><strong>Escalation Chain:</strong> ${payload.escalationChain.join(' -> ')}</p>`
      : ''

    const html = `
      <h1>Escalation Notice</h1>
      <p><strong>Reason:</strong> ${payload.reason}</p>
      <p><strong>Original Request:</strong> ${payload.originalRequestId}</p>
      ${payload.escalationLevel ? `<p><strong>Escalation Level:</strong> ${payload.escalationLevel}</p>` : ''}
      ${chainHtml}
      ${slaWarningHtml}
      ${payload.slaDeadline ? `<p><strong>SLA Deadline:</strong> ${payload.slaDeadline.toISOString()}</p>` : ''}
    `

    const headers: Record<string, string> = {}
    if (payload.priority === 'urgent') {
      headers['X-Priority'] = '1'
      headers['Importance'] = 'high'
    } else {
      headers['X-Priority'] = '2'
      headers['Importance'] = 'high'
    }

    const result = await this.send({
      to: payload.to,
      requestId: payload.escalationId,
      message: payload.reason,
      subject: payload.subject || `[ESCALATION] ${payload.reason}`,
      priority: payload.priority,
    })

    return {
      ...result,
      headers,
    }
  }

  /**
   * Send batch emails with rate limiting
   */
  async sendBatch(
    notifications: SESNotificationPayload[],
    options?: BatchSendOptions
  ): Promise<SESDeliveryResult[]> {
    const results: SESDeliveryResult[] = []
    const rateLimit = options?.rateLimit || 14 // SES default is 14/second
    const delayMs = Math.ceil(1000 / rateLimit)

    for (let i = 0; i < notifications.length; i++) {
      const notification = notifications[i]!

      try {
        const result = await this.send(notification, {
          retries: options?.retryOnThrottle ? options.maxRetries || 3 : 0,
          retryDelay: 1000,
        })
        results.push(result)
      } catch (error) {
        results.push({
          delivered: false,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        })
      }

      // Rate limit delay (except for last item)
      if (i < notifications.length - 1) {
        await this.delay(delayMs)
      }
    }

    return results
  }

  /**
   * Get delivery status for a message
   */
  async getDeliveryStatus(
    messageId: string,
    options?: DeliveryStatusOptions
  ): Promise<SESDeliveryStatus> {
    const timeout = options?.timeout || 30000
    const pollInterval = options?.pollInterval || 2000
    const startTime = Date.now()

    // Check cache first
    const cached = this.deliveryStatuses.get(messageId)
    if (cached && ['delivered', 'bounced', 'complained'].includes(cached.state)) {
      return cached
    }

    // Poll for status
    while (Date.now() - startTime < timeout) {
      const status = this.deliveryStatuses.get(messageId)
      if (status && ['delivered', 'bounced', 'complained'].includes(status.state)) {
        return status
      }

      await this.delay(pollInterval)
    }

    // Return pending if no status available
    return {
      state: 'pending',
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Handle SNS bounce notification
   */
  async handleBounce(event: SNSBounceEvent): Promise<BounceHandleResult> {
    const { bounce, mail } = event

    // Update delivery status
    this.deliveryStatuses.set(mail.messageId, {
      state: 'bounced',
      timestamp: bounce.timestamp,
      details: { bounceType: bounce.bounceType, bounceSubType: bounce.bounceSubType },
    })

    const recipientsSuppressed: string[] = []

    if (bounce.bounceType === 'Permanent') {
      // Hard bounce - suppress recipients
      for (const recipient of bounce.bouncedRecipients) {
        this.suppressionList.add(recipient.emailAddress.toLowerCase())
        recipientsSuppressed.push(recipient.emailAddress)
      }

      return {
        processed: true,
        bounceType: bounce.bounceType,
        action: 'suppress',
        recipientsSuppressed,
      }
    } else if (bounce.bounceType === 'Transient') {
      // Soft bounce - schedule retry
      const retryAfter = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

      return {
        processed: true,
        bounceType: bounce.bounceType,
        action: 'retry',
        retryAfter,
      }
    }

    return {
      processed: true,
      bounceType: bounce.bounceType,
      action: 'ignore',
    }
  }

  /**
   * Handle SNS complaint notification
   */
  async handleComplaint(event: SNSComplaintEvent): Promise<ComplaintHandleResult> {
    const { complaint, mail } = event

    // Update delivery status
    this.deliveryStatuses.set(mail.messageId, {
      state: 'complained',
      timestamp: complaint.timestamp,
      details: { complaintType: complaint.complaintFeedbackType },
    })

    const recipientsSuppressed: string[] = []

    // Always suppress complained recipients
    for (const recipient of complaint.complainedRecipients) {
      this.suppressionList.add(recipient.emailAddress.toLowerCase())
      recipientsSuppressed.push(recipient.emailAddress)
    }

    return {
      processed: true,
      complaintType: complaint.complaintFeedbackType,
      recipientsSuppressed,
    }
  }

  /**
   * Check if recipient is in suppression list
   */
  async isRecipientSuppressed(email: string): Promise<boolean> {
    return this.suppressionList.has(email.toLowerCase())
  }

  /**
   * Cleanup resources
   */
  async close(): Promise<void> {
    this.deliveryStatuses.clear()
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Send email via SES API
   */
  private async sendViaSES(
    to: string,
    subject: string,
    html: string,
    text: string,
    headers: Record<string, string>,
    options?: SendOptions
  ): Promise<SESDeliveryResult> {
    const timestamp = new Date().toISOString()
    const endpoint = `https://email.${this.config.region}.amazonaws.com`

    const body = {
      Content: {
        Simple: {
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            Text: { Data: text, Charset: 'UTF-8' },
          },
          Subject: { Data: subject, Charset: 'UTF-8' },
        },
      },
      Destination: {
        ToAddresses: [to],
      },
      FromEmailAddress: this.config.fromEmail,
    }

    const response = await this.signAndFetch(
      `${endpoint}/v2/email/outbound-emails`,
      'POST',
      body
    )

    const data = await response.json().catch(() => ({})) as { MessageId?: string; message?: string }
    const isSuccess = response.status >= 200 && response.status < 300

    if (isSuccess && data.MessageId) {
      // Track initial delivery status
      this.deliveryStatuses.set(data.MessageId, {
        state: 'sent',
        timestamp,
      })
    }

    // Check for specific error types
    let errorMessage: string | undefined
    if (!isSuccess) {
      const errorText = await response.text().catch(() => '')
      // Check for credential errors first (higher priority)
      if (response.status === 401 ||
          errorText.includes('credential') ||
          errorText.includes('auth') ||
          errorText.includes('Signature') ||
          errorText.includes('AccessDenied') ||
          errorText.includes('InvalidAccessKeyId') ||
          errorText.includes('SignatureDoesNotMatch')) {
        errorMessage = 'Invalid AWS credentials or access denied'
      } else if (errorText.includes('not verified') || errorText.includes('identity')) {
        errorMessage = 'Email identity not verified'
      } else if (response.status === 403) {
        // 403 without identity message usually means credential issue
        errorMessage = 'Access denied - check AWS credentials'
      } else {
        errorMessage = data.message || `HTTP ${response.status}`
      }
    }

    return {
      delivered: isSuccess,
      messageId: data.MessageId || generateMessageId(),
      error: errorMessage,
      timestamp,
    }
  }

  /**
   * Sign and send request with AWS Signature v4
   */
  private async signAndFetch(
    url: string,
    method: string,
    body: unknown
  ): Promise<Response> {
    const { credentials, region } = this.config

    // If no credentials, assume IAM role (just make the request)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (credentials) {
      // Add AWS Signature v4 authentication
      const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
      const date = timestamp.slice(0, 8)

      headers['X-Amz-Date'] = timestamp

      // Simplified signing (real implementation would use full AWS Signature v4)
      // For production, use @aws-sdk/client-ses or aws4 library
      const credential = `${credentials.accessKeyId}/${date}/${region}/ses/aws4_request`
      headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${credential}`

      if (credentials.sessionToken) {
        headers['X-Amz-Security-Token'] = credentials.sessionToken
      }
    }

    return this._fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })
  }

  /**
   * Generate S3 presigned URL for attachment
   */
  private async generatePresignedUrl(attachment: S3Attachment): Promise<string> {
    const { s3Bucket, s3Key, expiresIn = 86400 } = attachment
    const { region, credentials } = this.config

    // Simplified presigned URL generation
    // For production, use @aws-sdk/s3-request-presigner
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const expiration = Math.floor(Date.now() / 1000) + expiresIn

    // Build presigned URL
    const host = `${s3Bucket}.s3.${region}.amazonaws.com`
    const accessKey = credentials?.accessKeyId || 'IAM_ROLE'

    return `https://${host}/${s3Key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${accessKey}%2F${timestamp.slice(0, 8)}%2F${region}%2Fs3%2Faws4_request&X-Amz-Date=${timestamp}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=host`
  }

  /**
   * Build email subject line
   */
  private buildSubject(payload: NotificationPayload): string {
    const priorityPrefix = payload.priority === 'urgent' ? '[URGENT] ' :
                           payload.priority === 'high' ? '[Action Required] ' : ''
    const shortMessage = payload.message.substring(0, 50)
    return `${priorityPrefix}${shortMessage}${payload.message.length > 50 ? '...' : ''}`
  }

  /**
   * Render HTML email with action buttons
   */
  private renderHtml(payload: NotificationPayload): string {
    const baseUrl = payload.baseUrl || this.config.baseUrl || DEFAULT_BASE_URL
    const actions = payload.actions ?? this.defaultActions()

    const actionButtons = actions
      .map(action => {
        const url = `${baseUrl}/approve/${payload.requestId}?action=${encodeURIComponent(action.value)}`
        const bgColor = action.style === 'danger' ? '#ef4444' :
                        action.style === 'success' || action.style === 'primary' ? '#22c55e' : '#6b7280'
        return `<a href="${url}" style="display: inline-block; padding: 12px 24px; margin: 0 8px; background-color: ${bgColor}; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">${action.label}</a>`
      })
      .join('')

    const metadataHtml = payload.metadata
      ? `<table style="margin: 20px 0; border-collapse: collapse; width: 100%;">
          ${Object.entries(payload.metadata)
            .map(([key, value]) => `
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; text-transform: capitalize;">${key}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${value}</td>
              </tr>
            `)
            .join('')}
        </table>`
      : ''

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 20px; font-size: 24px; color: #333;">Notification</h1>
              <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #555;">${payload.message}</p>
              ${metadataHtml}
              <div style="margin-top: 30px; text-align: center;">
                ${actionButtons}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  }

  /**
   * Default approve/reject actions
   */
  private defaultActions(): NotificationAction[] {
    return [
      { label: 'Approve', value: 'approve', style: 'success' },
      { label: 'Reject', value: 'reject', style: 'danger' },
    ]
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
