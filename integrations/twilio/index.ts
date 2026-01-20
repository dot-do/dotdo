// Twilio Integration
// SMS and messaging capabilities for the dotdo integration registry (do-h3in)

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
import { verifyTwilioSignature } from '../webhook-verify'

/**
 * Twilio-specific configuration
 */
export interface TwilioConfig extends IntegrationConfig {
  /** Twilio Account SID (starts with AC) */
  accountSid: string
  /** Twilio Auth Token */
  authToken: string
  /** Default sender phone number */
  defaultFrom?: string
  /** Messaging Service SID (optional) */
  messagingServiceSid?: string
  /** Webhook URL for status callbacks */
  statusCallbackUrl?: string
  /** Base URL for webhook signature verification (required for signature validation) */
  webhookBaseUrl?: string
  /** Whether to validate webhook signatures (default: true if authToken is present) */
  validateWebhookSignature?: boolean
}

/**
 * SMS/MMS send request
 */
export interface SendSmsRequest {
  /** Recipient phone number (E.164 format) */
  to: string
  /** Sender phone number (E.164 format) */
  from?: string
  /** Message body text */
  body: string
  /** Media URLs for MMS */
  mediaUrl?: string[]
  /** Status callback URL */
  statusCallback?: string
  /** Messaging Service SID override */
  messagingServiceSid?: string
}

/**
 * SMS/MMS send response
 */
export interface SendSmsResponse {
  /** Message SID */
  messageSid: string
  /** Current message status */
  status: TwilioMessageStatus
  /** Sender phone number */
  from: string
  /** Recipient phone number */
  to: string
  /** Message body */
  body: string
  /** Number of message segments */
  numSegments: number
  /** Price of the message (if available) */
  price?: string
  /** Price unit */
  priceUnit?: string
  /** Date the message was created */
  dateCreated: Date
}

/**
 * Twilio message status
 */
export type TwilioMessageStatus =
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'receiving'
  | 'received'
  | 'read'

/**
 * Twilio message resource
 */
export interface TwilioMessage {
  messageSid: string
  accountSid: string
  status: TwilioMessageStatus
  from: string
  to: string
  body: string
  numSegments: number
  numMedia: number
  direction: 'inbound' | 'outbound-api' | 'outbound-call' | 'outbound-reply'
  price?: string
  priceUnit?: string
  errorCode?: number
  errorMessage?: string
  dateCreated: Date
  dateUpdated: Date
  dateSent?: Date
}

/**
 * Message list filter options
 */
export interface ListMessagesOptions {
  /** Filter by recipient */
  to?: string
  /** Filter by sender */
  from?: string
  /** Filter by date sent after */
  dateSentAfter?: Date
  /** Filter by date sent before */
  dateSentBefore?: Date
  /** Maximum number of results */
  limit?: number
}

/**
 * Phone number lookup result
 */
export interface PhoneNumberLookup {
  phoneNumber: string
  countryCode: string
  nationalFormat: string
  carrier?: {
    name: string
    type: 'mobile' | 'landline' | 'voip'
  }
  callerName?: {
    callerName: string
    callerType: 'consumer' | 'business'
  }
}

/**
 * Twilio integration methods
 */
export interface TwilioMethods extends Record<string, (...args: any[]) => Promise<IntegrationResult>> {
  // SMS/MMS
  sendSms: (request: SendSmsRequest) => Promise<IntegrationResult<SendSmsResponse>>
  sendMms: (request: SendSmsRequest) => Promise<IntegrationResult<SendSmsResponse>>
  getMessage: (messageSid: string) => Promise<IntegrationResult<TwilioMessage>>
  listMessages: (options: ListMessagesOptions) => Promise<IntegrationResult<TwilioMessage[]>>

  // Phone Number Lookup
  lookupPhoneNumber: (phoneNumber: string) => Promise<IntegrationResult<PhoneNumberLookup>>
}

/**
 * Twilio Integration
 * Provides SMS, MMS, and phone number capabilities
 */
export class TwilioIntegration implements Integration<TwilioConfig, TwilioMethods> {
  readonly name = 'twilio'
  readonly version = '1.0.0'
  readonly metadata: IntegrationMetadata = {
    displayName: 'Twilio',
    description: 'SMS, MMS, and programmable messaging',
    category: 'sms',
    docsUrl: 'https://www.twilio.com/docs',
    websiteUrl: 'https://www.twilio.com',
    requiredConfig: ['accountSid', 'authToken'],
    optionalConfig: ['defaultFrom', 'messagingServiceSid', 'statusCallbackUrl'],
  }

  private _status: IntegrationStatus = 'uninitialized'
  private config: TwilioConfig | null = null
  private webhookHandlers: IntegrationWebhookHandler[] = []

  get status(): IntegrationStatus {
    return this._status
  }

  async init(config: TwilioConfig): Promise<void> {
    this._status = 'initializing'

    try {
      // Validate required config
      if (!config.accountSid) {
        throw new Error('Twilio Account SID is required')
      }
      if (!config.authToken) {
        throw new Error('Twilio Auth token is required')
      }

      // Validate Account SID format (starts with AC and is 34 characters)
      if (!config.accountSid.startsWith('AC') || config.accountSid.length !== 34) {
        throw new Error('Invalid Twilio Account SID format')
      }

      this.config = config

      // In a real implementation, you would:
      // 1. Initialize the Twilio client
      // 2. Verify credentials by making a test API call
      // 3. Validate the default from number if provided

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
  readonly methods: TwilioMethods = {
    sendSms: async (request) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'Twilio integration is not initialized')
      }

      // Validate request
      if (!request.to) {
        return errorResult('INVALID_REQUEST', 'Recipient (to) is required')
      }
      if (!request.body) {
        return errorResult('INVALID_REQUEST', 'Message body is required')
      }

      // Determine from number
      const from = request.from || this.config.defaultFrom
      if (!from && !this.config.messagingServiceSid && !request.messagingServiceSid) {
        return errorResult('INVALID_REQUEST', 'Sender (from) or messagingServiceSid is required')
      }

      // Stub implementation - returns mock data
      const response: SendSmsResponse = {
        messageSid: `SM${generateId()}`,
        status: 'queued',
        from: from || '+10000000000',
        to: request.to,
        body: request.body,
        numSegments: Math.ceil(request.body.length / 160),
        dateCreated: new Date(),
      }

      return successResult(response, `req_${generateId()}`)
    },

    sendMms: async (request) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'Twilio integration is not initialized')
      }

      // Validate request
      if (!request.to) {
        return errorResult('INVALID_REQUEST', 'Recipient (to) is required')
      }
      if (!request.mediaUrl || request.mediaUrl.length === 0) {
        return errorResult('INVALID_REQUEST', 'Media URL is required for MMS')
      }

      // Determine from number
      const from = request.from || this.config.defaultFrom

      // Stub implementation - returns mock data
      const response: SendSmsResponse = {
        messageSid: `MM${generateId()}`,
        status: 'queued',
        from: from || '+10000000000',
        to: request.to,
        body: request.body || '',
        numSegments: 1,
        dateCreated: new Date(),
      }

      return successResult(response, `req_${generateId()}`)
    },

    getMessage: async (messageSid) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'Twilio integration is not initialized')
      }

      // Stub implementation - returns mock data
      const message: TwilioMessage = {
        messageSid,
        accountSid: this.config.accountSid,
        status: 'delivered',
        from: '+15551234567',
        to: '+15559876543',
        body: 'Test message',
        numSegments: 1,
        numMedia: 0,
        direction: 'outbound-api',
        dateCreated: new Date(),
        dateUpdated: new Date(),
        dateSent: new Date(),
      }

      return successResult(message, `req_${generateId()}`)
    },

    listMessages: async (options) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'Twilio integration is not initialized')
      }

      // Stub implementation - returns mock data
      const messages: TwilioMessage[] = [
        {
          messageSid: `SM${generateId()}`,
          accountSid: this.config.accountSid,
          status: 'delivered',
          from: options.from || '+15551234567',
          to: options.to || '+15559876543',
          body: 'Hello from Twilio!',
          numSegments: 1,
          numMedia: 0,
          direction: 'outbound-api',
          dateCreated: new Date(),
          dateUpdated: new Date(),
          dateSent: new Date(),
        },
      ]

      return successResult(messages, `req_${generateId()}`)
    },

    lookupPhoneNumber: async (phoneNumber) => {
      if (this._status !== 'ready' || !this.config) {
        return errorResult('NOT_INITIALIZED', 'Twilio integration is not initialized')
      }

      // Stub implementation - returns mock data
      const lookup: PhoneNumberLookup = {
        phoneNumber,
        countryCode: 'US',
        nationalFormat: phoneNumber.replace('+1', '(') + ') ' + phoneNumber.slice(-7, -4) + '-' + phoneNumber.slice(-4),
        carrier: {
          name: 'Carrier Name',
          type: 'mobile',
        },
      }

      return successResult(lookup, `req_${generateId()}`)
    },
  }

  /**
   * Handle incoming webhooks from Twilio
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (this._status !== 'ready' || !this.config) {
      return new Response('Integration not initialized', { status: 503 })
    }

    try {
      const contentType = request.headers.get('Content-Type') || ''
      let params: Record<string, string>

      // Twilio sends webhooks as form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await request.text()
        params = Object.fromEntries(new URLSearchParams(body))
      } else {
        // Fallback to JSON
        params = await request.json()
      }

      // In a real implementation, you would:
      // 1. Verify the webhook signature
      // 2. Parse the event type (incoming message, status callback, etc.)

      // Determine event type
      const eventType = params.MessageStatus ? 'message.status' : 'message.incoming'

      // Create integration event
      const integrationEvent: IntegrationEvent = {
        integration: this.name,
        type: eventType,
        payload: params,
        timestamp: new Date(),
        webhookId: params.MessageSid,
      }

      // Call all registered handlers
      for (const handler of this.webhookHandlers) {
        await handler(integrationEvent)
      }

      // Twilio expects TwiML response or empty 200
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    } catch (error) {
      console.error('Twilio webhook error:', error)
      return new Response('Webhook error', { status: 400 })
    }
  }

  /**
   * Register a handler for Twilio webhook events
   */
  onEvent(handler: IntegrationWebhookHandler): void {
    this.webhookHandlers.push(handler)
  }
}

/**
 * Generate a random ID for stub responses
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

/**
 * Factory function for creating Twilio integration
 */
export function createTwilioIntegration(): TwilioIntegration {
  return new TwilioIntegration()
}

/**
 * Default export
 */
export default TwilioIntegration
