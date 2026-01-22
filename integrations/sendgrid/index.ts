// SendGrid Integration Stub
// Example integration for the dotdo integration registry (do-laux)

import type {
  Integration,
  IntegrationConfig,
  IntegrationStatus,
  IntegrationMetadata,
  IntegrationResult,
  IntegrationWebhookHandler,
  IntegrationEvent,
} from '../types'
import { successResult, errorResult } from '../registry'
import { verifySendGridSignature } from '../webhook-verify'

/**
 * SendGrid-specific configuration
 */
export interface SendGridConfig extends IntegrationConfig {
  /** SendGrid API key */
  apiKey: string
  /** Default sender email address */
  defaultFrom?: string
  /** Default sender name */
  defaultFromName?: string
  /** Webhook signing key */
  webhookSigningKey?: string
}

/**
 * Email recipient
 */
export interface EmailRecipient {
  email: string
  name?: string
}

/**
 * Email attachment
 */
export interface EmailAttachment {
  content: string // Base64 encoded content
  filename: string
  type?: string
  disposition?: 'attachment' | 'inline'
  contentId?: string
}

/**
 * Email send request
 */
export interface SendEmailRequest {
  to: EmailRecipient | EmailRecipient[]
  from?: EmailRecipient
  subject: string
  text?: string
  html?: string
  templateId?: string
  dynamicTemplateData?: Record<string, unknown>
  attachments?: EmailAttachment[]
  replyTo?: EmailRecipient
  cc?: EmailRecipient[]
  bcc?: EmailRecipient[]
  categories?: string[]
  customArgs?: Record<string, string>
  sendAt?: Date
}

/**
 * Email send response
 */
export interface SendEmailResponse {
  messageId: string
  accepted: string[]
  rejected: string[]
}

/**
 * Contact data for SendGrid lists
 */
export interface SendGridContact {
  id?: string
  email: string
  firstName?: string
  lastName?: string
  customFields?: Record<string, string | number>
}

/**
 * Email statistics
 */
export interface EmailStats {
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
  spamReported: number
}

/**
 * SendGrid integration methods
 */
export interface SendGridMethods extends Record<string, (...args: any[]) => Promise<IntegrationResult>> {
  // Email sending
  sendEmail: (request: SendEmailRequest) => Promise<IntegrationResult<SendEmailResponse>>
  sendTemplateEmail: (
    templateId: string,
    to: EmailRecipient | EmailRecipient[],
    dynamicData: Record<string, unknown>
  ) => Promise<IntegrationResult<SendEmailResponse>>

  // Contact management
  addContact: (contact: SendGridContact) => Promise<IntegrationResult<SendGridContact>>
  getContact: (email: string) => Promise<IntegrationResult<SendGridContact | null>>
  deleteContact: (email: string) => Promise<IntegrationResult<boolean>>

  // Statistics
  getStats: (startDate: Date, endDate?: Date) => Promise<IntegrationResult<EmailStats>>
}

/**
 * SendGrid Integration
 * Provides email sending and contact management capabilities
 */
export class SendGridIntegration implements Integration<SendGridConfig, SendGridMethods> {
  readonly name = 'sendgrid'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'SendGrid',
    description: 'Email sending and marketing automation',
    category: 'email',
    docsUrl: 'https://docs.sendgrid.com',
    websiteUrl: 'https://sendgrid.com',
    requiredConfig: ['apiKey'],
    optionalConfig: ['defaultFrom', 'defaultFromName', 'webhookSigningKey'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: SendGridConfig | null = null
  private webhookHandlers: IntegrationWebhookHandler[] = []

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: SendGridConfig): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate required config
      if (!config.apiKey) {
        throw new Error('SendGrid API key is required')
      }

      // Validate API key format (SendGrid keys start with SG.)
      if (!config.apiKey.startsWith('SG.')) {
        throw new Error('Invalid SendGrid API key format')
      }

      this.config = config

      // In a real implementation, you would:
      // 1. Initialize the SendGrid SDK
      // 2. Verify the API key by making a test request
      // 3. Validate sender identity

      this._status = 'ready'
    } catch (error) {
      this._status = 'error'
      throw error
    }
  }

  async shutdown(): Promise<void> {
    this.config = null
    this.webhookHandlers = []
    this._status = 'uninitialized'
  }

  async healthCheck(): Promise<boolean> {
    if (this._status !== 'ready' || !this.config) {
      return false
    }

    // In a real implementation, you would make a test API call
    // For the stub, we just return true
    return true
  }

  /**
   * Methods exposed by this integration
   */
  readonly methods: SendGridMethods = {
    sendEmail: async (request) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Validate request
      if (!request.to) {
        return errorResult('INVALID_REQUEST', 'Recipient (to) is required')
      }
      if (!request.subject) {
        return errorResult('INVALID_REQUEST', 'Subject is required')
      }
      if (!request.text && !request.html && !request.templateId) {
        return errorResult('INVALID_REQUEST', 'Email content (text, html, or templateId) is required')
      }

      // Stub implementation - returns mock data
      const recipients = Array.isArray(request.to) ? request.to : [request.to]
      const response: SendEmailResponse = {
        messageId: `msg_${generateId()}`,
        accepted: recipients.map((r) => r.email),
        rejected: [],
      }

      return successResult(response, `req_${generateId()}`)
    },

    sendTemplateEmail: async (templateId, to, dynamicData) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Validate request
      if (!templateId) {
        return errorResult('INVALID_REQUEST', 'Template ID is required')
      }

      // Stub implementation - returns mock data
      const recipients = Array.isArray(to) ? to : [to]
      const response: SendEmailResponse = {
        messageId: `msg_${generateId()}`,
        accepted: recipients.map((r) => r.email),
        rejected: [],
      }

      return successResult(response, `req_${generateId()}`)
    },

    addContact: async (contact) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Validate request
      if (!contact.email) {
        return errorResult('INVALID_REQUEST', 'Contact email is required')
      }

      // Stub implementation - returns mock data
      const savedContact: SendGridContact = {
        id: `con_${generateId()}`,
        ...contact,
      }

      return successResult(savedContact, `req_${generateId()}`)
    },

    getContact: async (email) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Stub implementation - returns mock data
      const contact: SendGridContact = {
        id: `con_${generateId()}`,
        email,
        firstName: 'Test',
        lastName: 'User',
      }

      return successResult(contact, `req_${generateId()}`)
    },

    deleteContact: async (email) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Stub implementation - returns success
      return successResult(true, `req_${generateId()}`)
    },

    getStats: async (startDate, endDate) => {
      if (this._status !== 'ready') {
        return errorResult('NOT_INITIALIZED', 'SendGrid integration is not initialized')
      }

      // Stub implementation - returns mock data
      const stats: EmailStats = {
        delivered: 1000,
        opened: 450,
        clicked: 150,
        bounced: 25,
        unsubscribed: 10,
        spamReported: 2,
      }

      return successResult(stats, `req_${generateId()}`)
    },
  }

  /**
   * Handle incoming webhooks from SendGrid
   *
   * This implementation validates webhook signatures when a webhookSigningKey is configured.
   * SendGrid uses ECDSA P-256 signatures with the following headers:
   * - X-Twilio-Email-Event-Webhook-Signature: Base64 encoded ECDSA signature
   * - X-Twilio-Email-Event-Webhook-Timestamp: Unix timestamp
   *
   * @param request - Incoming webhook request
   * @returns Response with appropriate status code
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (this._status !== 'ready' || !this.config) {
      return new Response('Integration not initialized', { status: 503 })
    }

    try {
      const body = await request.text()
      const signatureHeader = request.headers.get('X-Twilio-Email-Event-Webhook-Signature')
      const timestampHeader = request.headers.get('X-Twilio-Email-Event-Webhook-Timestamp')

      // Check for missing signature headers when signing key is configured
      if (this.config.webhookSigningKey) {
        if (!signatureHeader || !timestampHeader) {
          return new Response(
            JSON.stringify({ error: 'Missing signature headers' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          )
        }

        // Verify the signature
        const verification = await verifySendGridSignature(
          body,
          signatureHeader,
          timestampHeader,
          this.config.webhookSigningKey
        )

        if (!verification.valid) {
          return new Response(
            JSON.stringify({ error: 'Signature verification failed' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      const events = JSON.parse(body) as Array<{
        event: string
        email: string
        timestamp: number
        sg_message_id: string
        [key: string]: unknown
      }>

      // Process each event
      for (const event of events) {
        const integrationEvent: IntegrationEvent = {
          integration: this.name,
          type: event.event,
          payload: event,
          timestamp: new Date(event.timestamp * 1000),
          webhookId: event.sg_message_id,
        }

        // Call all registered handlers
        for (const handler of this.webhookHandlers) {
          await handler(integrationEvent)
        }
      }

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('SendGrid webhook error:', error)
      return new Response('Webhook error', { status: 400 })
    }
  }

  /**
   * Register a handler for SendGrid webhook events
   */
  onEvent(handler: IntegrationWebhookHandler): void {
    this.webhookHandlers.push(handler)
  }
}

/**
 * Generate a random ID for stub responses
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Factory function for creating SendGrid integration
 */
export function createSendGridIntegration(): SendGridIntegration {
  return new SendGridIntegration()
}

/**
 * Default export
 */
export default SendGridIntegration
