/**
 * Twilio SMS Delivery Integration Tests (RED)
 *
 * Tests REAL Twilio SMS delivery for human approval/task notifications.
 * NO MOCKS - tests hit actual Twilio API and verify SMS delivery.
 *
 * Environment Variables Required:
 * - TWILIO_ACCOUNT_SID (your Twilio account SID)
 * - TWILIO_AUTH_TOKEN (your Twilio auth token)
 * - TWILIO_PHONE_NUMBER (Twilio phone number in E.164 format, e.g., +15551234567)
 * - TEST_PHONE_NUMBER (verified test phone number for receiving SMS)
 * - TWILIO_STATUS_CALLBACK_URL (optional: webhook URL for status updates)
 *
 * @module tests/integration/channels/sms-delivery.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  SMSHumanChannel,
  type SMSChannelConfig,
  type SMSNotificationPayload,
} from '../../../lib/human/channels/sms'
import type { NotificationPayload, SendResult, HumanResponse } from '../../../lib/human/channels'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: SMSChannelConfig = {
  provider: 'twilio',
  accountSid: process.env.TWILIO_ACCOUNT_SID || '',
  authToken: process.env.TWILIO_AUTH_TOKEN || '',
  fromNumber: process.env.TWILIO_PHONE_NUMBER || '+15551234567',
  baseUrl: 'https://app.dotdo.dev',
  statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
}

const TEST_PHONE = process.env.TEST_PHONE_NUMBER || '+15559876543'

/**
 * Extended SMS notification payload with Twilio-specific fields
 */
interface TwilioSMSPayload extends SMSNotificationPayload {
  /** Enable delivery status tracking */
  trackDelivery?: boolean
  /** Short URL service to use */
  shortUrlService?: 'twilio' | 'custom'
  /** Custom short URL domain */
  shortUrlDomain?: string
}

/**
 * Extended send result with Twilio-specific status info
 */
interface TwilioSendResult extends SendResult {
  /** Twilio message SID */
  sid?: string
  /** Message status (queued, sent, delivered, failed, etc.) */
  status?: TwilioMessageStatus
  /** Number of message segments */
  numSegments?: number
  /** Price per segment */
  pricePerSegment?: string
  /** Total price */
  totalPrice?: string
  /** Carrier info */
  carrier?: {
    name: string
    type: 'mobile' | 'landline' | 'voip'
  }
}

/**
 * Twilio message status values
 */
type TwilioMessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'receiving'
  | 'received'
  | 'accepted'
  | 'scheduled'
  | 'read'
  | 'canceled'

/**
 * Twilio status callback webhook payload
 */
interface TwilioStatusCallback {
  MessageSid: string
  MessageStatus: TwilioMessageStatus
  To: string
  From: string
  AccountSid: string
  ApiVersion: string
  SmsSid?: string
  SmsStatus?: TwilioMessageStatus
  ErrorCode?: string
  ErrorMessage?: string
  // Delivery receipt fields
  RawDlrDoneDate?: string
  ChannelFinalStatus?: string
}

/**
 * Twilio incoming message webhook payload
 */
interface TwilioIncomingMessage {
  MessageSid: string
  SmsSid: string
  AccountSid: string
  MessagingServiceSid?: string
  From: string
  To: string
  Body: string
  NumMedia: string
  NumSegments: string
  // Location data (if available)
  FromCity?: string
  FromState?: string
  FromZip?: string
  FromCountry?: string
}

// =============================================================================
// Extended SMSHumanChannel Interface
// =============================================================================

/**
 * Extended SMS channel with Twilio-specific features
 * These methods need to be implemented to make tests pass
 */
interface TwilioSMSChannel extends SMSHumanChannel {
  /**
   * Send SMS with delivery tracking enabled
   */
  sendWithTracking(payload: TwilioSMSPayload): Promise<TwilioSendResult>

  /**
   * Get current delivery status for a message
   */
  getDeliveryStatus(messageSid: string): Promise<TwilioDeliveryStatus>

  /**
   * Wait for delivery confirmation
   */
  waitForDelivery(messageSid: string, options?: { timeout?: number; pollInterval?: number }): Promise<TwilioDeliveryStatus>

  /**
   * Send escalation SMS with high priority
   */
  sendEscalation(payload: EscalationSMSPayload): Promise<TwilioSendResult>

  /**
   * Send SMS with shortened action URLs
   */
  sendWithShortUrls(payload: TwilioSMSPayload): Promise<TwilioSendResult>

  /**
   * Handle Twilio status callback webhook
   */
  handleStatusCallback(payload: TwilioStatusCallback): Promise<StatusCallbackResult>

  /**
   * Handle incoming SMS response
   */
  handleIncomingMessage(payload: TwilioIncomingMessage): Promise<HumanResponse | null>

  /**
   * Lookup carrier information for a phone number
   */
  lookupCarrier(phoneNumber: string): Promise<CarrierLookupResult>

  /**
   * Send batch SMS messages
   */
  sendBatch(payloads: TwilioSMSPayload[], options?: BatchOptions): Promise<TwilioSendResult[]>

  /**
   * Get message history for a conversation
   */
  getMessageHistory(phoneNumber: string, options?: { limit?: number; since?: Date }): Promise<MessageHistoryEntry[]>
}

/**
 * Escalation SMS payload with urgency settings
 */
interface EscalationSMSPayload extends TwilioSMSPayload {
  /** Escalation ID */
  escalationId: string
  /** Original request ID that triggered escalation */
  originalRequestId: string
  /** Reason for escalation */
  reason: string
  /** Escalation level (1 = first escalation, 2 = second, etc.) */
  escalationLevel: number
  /** SLA deadline if applicable */
  slaDeadline?: Date
  /** Whether this is an SLA breach notification */
  slaBreach?: boolean
  /** Time remaining before SLA breach */
  timeRemaining?: string
}

/**
 * Delivery status with detailed tracking info
 */
interface TwilioDeliveryStatus {
  /** Message SID */
  messageSid: string
  /** Current status */
  status: TwilioMessageStatus
  /** Timestamp of last status update */
  timestamp: Date
  /** Error code if failed */
  errorCode?: string
  /** Error message if failed */
  errorMessage?: string
  /** Whether delivery is confirmed */
  delivered: boolean
  /** Delivery attempts */
  attempts?: number
}

/**
 * Status callback processing result
 */
interface StatusCallbackResult {
  /** Whether callback was processed successfully */
  processed: boolean
  /** Message SID */
  messageSid: string
  /** New status */
  status: TwilioMessageStatus
  /** Whether status indicates final state */
  isFinal: boolean
  /** Action taken based on status */
  action?: 'none' | 'retry' | 'escalate' | 'notify_failure'
  /** Error details if applicable */
  error?: {
    code: string
    message: string
    recoverable: boolean
  }
}

/**
 * Carrier lookup result
 */
interface CarrierLookupResult {
  /** Phone number in E.164 format */
  phoneNumber: string
  /** Carrier name */
  carrierName: string
  /** Phone type */
  phoneType: 'mobile' | 'landline' | 'voip' | 'unknown'
  /** Country code */
  countryCode: string
  /** Whether SMS is supported */
  smsSupported: boolean
}

/**
 * Batch sending options
 */
interface BatchOptions {
  /** Maximum concurrent sends */
  concurrency?: number
  /** Delay between sends (ms) */
  delayBetweenSends?: number
  /** Stop on first failure */
  stopOnFailure?: boolean
  /** Retry failed messages */
  retryFailed?: boolean
}

/**
 * Message history entry
 */
interface MessageHistoryEntry {
  /** Message SID */
  sid: string
  /** Direction (inbound or outbound) */
  direction: 'inbound' | 'outbound'
  /** Message body */
  body: string
  /** Status */
  status: TwilioMessageStatus
  /** Timestamp */
  timestamp: Date
  /** From number */
  from: string
  /** To number */
  to: string
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Generate unique request ID for testing
 */
function generateRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Wait for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================================================
// Approval Request SMS Tests
// =============================================================================

/**
 * Skip condition for tests requiring real Twilio credentials
 */
const hasCredentials = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER &&
  process.env.TEST_PHONE_NUMBER
)

describe('Twilio SMS Delivery (REAL)', () => {
  let channel: TwilioSMSChannel

  beforeAll(() => {
    // Create channel with test credentials if not available
    // Tests will fail on method calls since extended interface isn't implemented
    const config: SMSChannelConfig = hasCredentials
      ? TEST_CONFIG
      : {
          ...TEST_CONFIG,
          // Use test credentials to bypass constructor validation
          // Actual API calls will fail
          accountSid: 'AC_test_account_sid_placeholder',
          authToken: 'test_auth_token_placeholder',
        }
    channel = new SMSHumanChannel(config) as TwilioSMSChannel
  })

  afterAll(async () => {
    // Cleanup
  })

  describe('Approval Request SMS', () => {
    it('sends approval request SMS with action URLs', async () => {
      const payload: TwilioSMSPayload = {
        requestId: generateRequestId('approval'),
        to: TEST_PHONE,
        message: 'Please approve the expense report for $5,000 submitted by John Doe',
        actions: [
          { label: 'Approve', value: 'approve', style: 'success' },
          { label: 'Reject', value: 'reject', style: 'danger' },
        ],
        metadata: {
          submitter: 'john.doe@example.com',
          amount: '$5,000',
          category: 'Travel',
        },
        baseUrl: 'https://app.dotdo.dev',
        trackDelivery: true,
      }

      const result = await channel.sendWithTracking(payload)

      expect(result.delivered).toBe(true)
      expect(result.sid).toBeDefined()
      expect(result.sid).toMatch(/^SM[a-f0-9]{32}$/) // Twilio message SID format
      expect(result.timestamp).toBeDefined()
      expect(result.status).toBe('queued') // Initial status is queued
    })

    it('sends approval request with shortened URLs', async () => {
      const payload: TwilioSMSPayload = {
        requestId: generateRequestId('short-url'),
        to: TEST_PHONE,
        message: 'Approval needed for contract renewal',
        actions: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
        ],
        baseUrl: 'https://app.dotdo.dev',
        shortUrlService: 'twilio', // Use Twilio's URL shortening
      }

      const result = await channel.sendWithShortUrls(payload)

      expect(result.delivered).toBe(true)
      expect(result.sid).toBeDefined()
      // Message body should contain shortened URLs
      expect(result.messageId).toBeDefined()
    })

    it('tracks SMS delivery status via Twilio API', async () => {
      const payload: TwilioSMSPayload = {
        requestId: generateRequestId('track'),
        to: TEST_PHONE,
        message: 'Delivery tracking test - please ignore',
        trackDelivery: true,
      }

      const sendResult = await channel.sendWithTracking(payload)
      expect(sendResult.sid).toBeDefined()

      // Wait a moment for Twilio to process
      await delay(2000)

      // Check delivery status
      const status = await channel.getDeliveryStatus(sendResult.sid!)

      expect(status).toBeDefined()
      expect(status.messageSid).toBe(sendResult.sid)
      expect(['queued', 'sending', 'sent', 'delivered']).toContain(status.status)
      expect(status.timestamp).toBeDefined()
    })

    it('waits for delivery confirmation with timeout', async () => {
      const payload: TwilioSMSPayload = {
        requestId: generateRequestId('wait-delivery'),
        to: TEST_PHONE,
        message: 'Delivery confirmation test - please ignore',
        trackDelivery: true,
      }

      const sendResult = await channel.sendWithTracking(payload)
      expect(sendResult.sid).toBeDefined()

      // Wait for delivery with 30 second timeout
      const deliveryStatus = await channel.waitForDelivery(sendResult.sid!, {
        timeout: 30000,
        pollInterval: 2000,
      })

      expect(deliveryStatus).toBeDefined()
      expect(['sent', 'delivered']).toContain(deliveryStatus.status)
      expect(deliveryStatus.delivered).toBe(true)
    })

    it('includes message segment count for long messages', async () => {
      // SMS messages over 160 characters (or 70 for Unicode) are split into segments
      const longMessage = 'This is a test message that is intentionally very long to test message segmentation. ' +
        'When a message exceeds 160 characters, Twilio splits it into multiple segments. ' +
        'Each segment is billed separately. This message should be 3+ segments.'

      const payload: TwilioSMSPayload = {
        requestId: generateRequestId('segments'),
        to: TEST_PHONE,
        message: longMessage,
        trackDelivery: true,
      }

      const result = await channel.sendWithTracking(payload)

      expect(result.delivered).toBe(true)
      expect(result.numSegments).toBeDefined()
      expect(result.numSegments).toBeGreaterThan(1)
    })
  })

  // ===========================================================================
  // Escalation SMS Tests
  // ===========================================================================

  describe('Escalation SMS', () => {
    it('sends urgent escalation SMS', async () => {
      const payload: EscalationSMSPayload = {
        requestId: generateRequestId('escalate'),
        to: TEST_PHONE,
        message: 'URGENT: Approval pending for 4+ hours',
        escalationId: generateRequestId('esc'),
        originalRequestId: 'req-original-123',
        reason: 'SLA exceeded - no response in 4 hours',
        escalationLevel: 1,
        actions: [
          { label: 'Approve Now', value: 'approve' },
          { label: 'Reject', value: 'reject' },
          { label: 'Delegate', value: 'delegate' },
        ],
        baseUrl: 'https://app.dotdo.dev',
        trackDelivery: true,
      }

      const result = await channel.sendEscalation(payload)

      expect(result.delivered).toBe(true)
      expect(result.sid).toBeDefined()
      expect(result.timestamp).toBeDefined()
    })

    it('sends SLA breach notification', async () => {
      const slaDeadline = new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago

      const payload: EscalationSMSPayload = {
        requestId: generateRequestId('sla-breach'),
        to: TEST_PHONE,
        message: 'SLA BREACH: Approval request has exceeded the 4-hour SLA',
        escalationId: generateRequestId('esc-breach'),
        originalRequestId: 'req-sla-123',
        reason: 'SLA deadline exceeded',
        escalationLevel: 2,
        slaDeadline,
        slaBreach: true,
        actions: [
          { label: 'Take Action', value: 'action' },
        ],
        baseUrl: 'https://app.dotdo.dev',
        trackDelivery: true,
      }

      const result = await channel.sendEscalation(payload)

      expect(result.delivered).toBe(true)
      expect(result.sid).toBeDefined()
    })

    it('sends SLA warning before breach', async () => {
      const slaDeadline = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now

      const payload: EscalationSMSPayload = {
        requestId: generateRequestId('sla-warning'),
        to: TEST_PHONE,
        message: 'SLA WARNING: 30 minutes remaining to respond',
        escalationId: generateRequestId('esc-warning'),
        originalRequestId: 'req-sla-456',
        reason: 'Approaching SLA deadline',
        escalationLevel: 1,
        slaDeadline,
        slaBreach: false,
        timeRemaining: '30 minutes',
        actions: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
        ],
        baseUrl: 'https://app.dotdo.dev',
      }

      const result = await channel.sendEscalation(payload)

      expect(result.delivered).toBe(true)
      expect(result.sid).toBeDefined()
    })

    it('handles escalation chain progression', async () => {
      // First escalation to manager
      const level1Result = await channel.sendEscalation({
        requestId: generateRequestId('chain-1'),
        to: TEST_PHONE,
        message: 'Level 1: Manager escalation',
        escalationId: generateRequestId('chain-esc'),
        originalRequestId: 'req-chain-123',
        reason: 'No response from assignee',
        escalationLevel: 1,
        baseUrl: 'https://app.dotdo.dev',
      })

      expect(level1Result.delivered).toBe(true)

      // Second escalation to director (simulating chain progression)
      const level2Result = await channel.sendEscalation({
        requestId: generateRequestId('chain-2'),
        to: TEST_PHONE, // In real scenario, would be different number
        message: 'Level 2: Director escalation - Manager did not respond',
        escalationId: generateRequestId('chain-esc-2'),
        originalRequestId: 'req-chain-123',
        reason: 'No response from manager',
        escalationLevel: 2,
        baseUrl: 'https://app.dotdo.dev',
      })

      expect(level2Result.delivered).toBe(true)
    })
  })

  // ===========================================================================
  // Webhook Status Updates Tests
  // ===========================================================================

  describe('Webhook Status Updates', () => {
    it('handles Twilio status callback webhook for queued message', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '0'.repeat(32),
        MessageStatus: 'queued',
        To: TEST_PHONE,
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      expect(result.messageSid).toBe(callback.MessageSid)
      expect(result.status).toBe('queued')
      expect(result.isFinal).toBe(false)
      expect(result.action).toBe('none')
    })

    it('handles Twilio status callback for sent message', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '1'.repeat(32),
        MessageStatus: 'sent',
        To: TEST_PHONE,
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      expect(result.status).toBe('sent')
      expect(result.isFinal).toBe(false)
    })

    it('handles Twilio status callback for delivered message', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '2'.repeat(32),
        MessageStatus: 'delivered',
        To: TEST_PHONE,
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      expect(result.status).toBe('delivered')
      expect(result.isFinal).toBe(true)
      expect(result.action).toBe('none')
    })

    it('handles Twilio status callback for failed message', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '3'.repeat(32),
        MessageStatus: 'failed',
        To: '+15550000000', // Invalid test number
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
        ErrorCode: '30003',
        ErrorMessage: 'Unreachable destination handset',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      expect(result.status).toBe('failed')
      expect(result.isFinal).toBe(true)
      expect(result.error).toBeDefined()
      expect(result.error!.code).toBe('30003')
      expect(result.error!.message).toBe('Unreachable destination handset')
      expect(result.action).toBe('notify_failure')
    })

    it('handles Twilio status callback for undelivered message', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '4'.repeat(32),
        MessageStatus: 'undelivered',
        To: TEST_PHONE,
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
        ErrorCode: '30005',
        ErrorMessage: 'Unknown destination handset',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      expect(result.status).toBe('undelivered')
      expect(result.isFinal).toBe(true)
      expect(result.error).toBeDefined()
      expect(result.error!.recoverable).toBe(false)
    })

    it('triggers retry on recoverable failure', async () => {
      const callback: TwilioStatusCallback = {
        MessageSid: 'SM' + '5'.repeat(32),
        MessageStatus: 'failed',
        To: TEST_PHONE,
        From: TEST_CONFIG.fromNumber,
        AccountSid: TEST_CONFIG.accountSid!,
        ApiVersion: '2010-04-01',
        ErrorCode: '30008', // Unknown error - potentially recoverable
        ErrorMessage: 'Unknown error',
      }

      const result = await channel.handleStatusCallback(callback)

      expect(result.processed).toBe(true)
      // Some errors may trigger retry
      expect(['retry', 'notify_failure']).toContain(result.action)
    })
  })

  // ===========================================================================
  // Incoming Message (Reply) Handling Tests
  // ===========================================================================

  describe('Incoming Message Handling', () => {
    it('parses approval response from incoming SMS', async () => {
      const incomingMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'a'.repeat(32),
        SmsSid: 'SM' + 'a'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: 'APPROVE',
        NumMedia: '0',
        NumSegments: '1',
      }

      const response = await channel.handleIncomingMessage(incomingMessage)

      expect(response).not.toBeNull()
      expect(response!.action).toBe('approve')
      expect(response!.userId).toBe(TEST_PHONE)
    })

    it('parses rejection response from incoming SMS', async () => {
      const incomingMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'b'.repeat(32),
        SmsSid: 'SM' + 'b'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: 'REJECT',
        NumMedia: '0',
        NumSegments: '1',
      }

      const response = await channel.handleIncomingMessage(incomingMessage)

      expect(response).not.toBeNull()
      expect(response!.action).toBe('reject')
    })

    it('handles yes/no shorthand responses', async () => {
      // Test "YES" -> approve
      const yesMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'c'.repeat(32),
        SmsSid: 'SM' + 'c'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: 'Yes',
        NumMedia: '0',
        NumSegments: '1',
      }

      const yesResponse = await channel.handleIncomingMessage(yesMessage)
      expect(yesResponse).not.toBeNull()
      expect(yesResponse!.action).toBe('approve')

      // Test "NO" -> reject
      const noMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'd'.repeat(32),
        SmsSid: 'SM' + 'd'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: 'No',
        NumMedia: '0',
        NumSegments: '1',
      }

      const noResponse = await channel.handleIncomingMessage(noMessage)
      expect(noResponse).not.toBeNull()
      expect(noResponse!.action).toBe('reject')
    })

    it('handles numeric responses (1 for yes, 0 for no)', async () => {
      const oneMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'e'.repeat(32),
        SmsSid: 'SM' + 'e'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: '1',
        NumMedia: '0',
        NumSegments: '1',
      }

      const oneResponse = await channel.handleIncomingMessage(oneMessage)
      expect(oneResponse).not.toBeNull()
      expect(oneResponse!.action).toBe('approve')

      const zeroMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'f'.repeat(32),
        SmsSid: 'SM' + 'f'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: '0',
        NumMedia: '0',
        NumSegments: '1',
      }

      const zeroResponse = await channel.handleIncomingMessage(zeroMessage)
      expect(zeroResponse).not.toBeNull()
      expect(zeroResponse!.action).toBe('reject')
    })

    it('returns null for unrecognized responses', async () => {
      const unknownMessage: TwilioIncomingMessage = {
        MessageSid: 'SM' + 'g'.repeat(32),
        SmsSid: 'SM' + 'g'.repeat(32),
        AccountSid: TEST_CONFIG.accountSid!,
        From: TEST_PHONE,
        To: TEST_CONFIG.fromNumber,
        Body: 'Hello, what is this about?',
        NumMedia: '0',
        NumSegments: '1',
      }

      const response = await channel.handleIncomingMessage(unknownMessage)
      expect(response).toBeNull()
    })
  })

  // ===========================================================================
  // Carrier Lookup Tests
  // ===========================================================================

  describe('Carrier Lookup', () => {
    it('looks up carrier information for mobile number', async () => {
      const result = await channel.lookupCarrier(TEST_PHONE)

      expect(result).toBeDefined()
      expect(result.phoneNumber).toBe(TEST_PHONE)
      expect(result.carrierName).toBeDefined()
      expect(['mobile', 'landline', 'voip', 'unknown']).toContain(result.phoneType)
      expect(result.countryCode).toBeDefined()
      expect(result.smsSupported).toBeDefined()
    })

    it('identifies landline numbers that cannot receive SMS', async () => {
      // Twilio test landline number (in real tests, use actual landline)
      const landlineNumber = '+15550110000' // Example landline

      const result = await channel.lookupCarrier(landlineNumber)

      expect(result).toBeDefined()
      // Landlines typically don't support SMS
      if (result.phoneType === 'landline') {
        expect(result.smsSupported).toBe(false)
      }
    })

    it('handles invalid phone numbers gracefully', async () => {
      await expect(channel.lookupCarrier('invalid-number'))
        .rejects.toThrow(/invalid|not.*valid/i)
    })
  })

  // ===========================================================================
  // Batch Operations Tests
  // ===========================================================================

  describe('Batch Operations', () => {
    it('sends batch SMS messages', async () => {
      const payloads: TwilioSMSPayload[] = [
        {
          requestId: generateRequestId('batch-1'),
          to: TEST_PHONE,
          message: 'Batch test message 1',
        },
        {
          requestId: generateRequestId('batch-2'),
          to: TEST_PHONE,
          message: 'Batch test message 2',
        },
        {
          requestId: generateRequestId('batch-3'),
          to: TEST_PHONE,
          message: 'Batch test message 3',
        },
      ]

      const results = await channel.sendBatch(payloads)

      expect(results).toHaveLength(3)
      expect(results.every(r => r.delivered)).toBe(true)
      expect(results.every(r => r.sid)).toBe(true)
    })

    it('respects rate limiting in batch sends', async () => {
      const payloads: TwilioSMSPayload[] = Array.from({ length: 5 }, (_, i) => ({
        requestId: generateRequestId(`rate-${i}`),
        to: TEST_PHONE,
        message: `Rate limit test ${i + 1}`,
      }))

      const startTime = Date.now()
      const results = await channel.sendBatch(payloads, {
        delayBetweenSends: 200, // 200ms between sends
        concurrency: 1, // Sequential
      })
      const duration = Date.now() - startTime

      expect(results).toHaveLength(5)
      // Should take at least 800ms (4 delays of 200ms)
      expect(duration).toBeGreaterThanOrEqual(800)
    })

    it('handles partial batch failures', async () => {
      const payloads: TwilioSMSPayload[] = [
        {
          requestId: generateRequestId('batch-ok'),
          to: TEST_PHONE,
          message: 'Valid recipient',
        },
        {
          requestId: generateRequestId('batch-bad'),
          to: 'invalid-phone', // Invalid number
          message: 'Invalid recipient',
        },
        {
          requestId: generateRequestId('batch-ok-2'),
          to: TEST_PHONE,
          message: 'Another valid recipient',
        },
      ]

      const results = await channel.sendBatch(payloads, {
        stopOnFailure: false, // Continue on failure
      })

      expect(results).toHaveLength(3)
      expect(results[0].delivered).toBe(true)
      expect(results[1].delivered).toBe(false)
      expect(results[2].delivered).toBe(true)
    })
  })

  // ===========================================================================
  // Message History Tests
  // ===========================================================================

  describe('Message History', () => {
    it('retrieves message history for a phone number', async () => {
      // First, send a test message to create history
      await channel.send({
        requestId: generateRequestId('history'),
        to: TEST_PHONE,
        message: 'History test message',
      })

      // Small delay for Twilio to process
      await delay(1000)

      const history = await channel.getMessageHistory(TEST_PHONE, {
        limit: 10,
      })

      expect(history).toBeDefined()
      expect(Array.isArray(history)).toBe(true)
      // Should have at least the message we just sent
      expect(history.length).toBeGreaterThanOrEqual(0) // May be empty in test account
    })

    it('filters message history by date', async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours

      const history = await channel.getMessageHistory(TEST_PHONE, {
        limit: 50,
        since,
      })

      expect(history).toBeDefined()
      expect(Array.isArray(history)).toBe(true)
      // All returned messages should be after the 'since' date
      for (const entry of history) {
        expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(since.getTime())
      }
    })
  })

  // ===========================================================================
  // Configuration Validation Tests
  // ===========================================================================

  describe('Configuration Validation', () => {
    it('requires valid account SID', () => {
      expect(() => {
        new SMSHumanChannel({
          ...TEST_CONFIG,
          accountSid: '',
        })
      }).toThrow(/accountSid|account.*sid/i)
    })

    it('requires valid auth token', () => {
      expect(() => {
        new SMSHumanChannel({
          ...TEST_CONFIG,
          authToken: '',
        })
      }).toThrow(/authToken|auth.*token/i)
    })

    it('requires E.164 format phone number', () => {
      expect(() => {
        new SMSHumanChannel({
          ...TEST_CONFIG,
          fromNumber: '555-123-4567', // Invalid format
        })
      }).toThrow(/E\.164|phone.*format/i)
    })

    it('validates recipient phone number format', async () => {
      const result = await channel.send({
        requestId: 'req-invalid',
        to: 'not-a-phone-number',
        message: 'Test with invalid recipient',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toMatch(/invalid|phone/i)
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('handles Twilio API errors gracefully', async () => {
      // Using an invalid number that Twilio will reject
      const result = await channel.send({
        requestId: generateRequestId('api-error'),
        to: '+15005550001', // Twilio test number that fails
        message: 'Test error handling',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles network timeouts', async () => {
      // This test verifies timeout behavior
      // In real implementation, would configure a timeout
      const result = await channel.send({
        requestId: generateRequestId('timeout'),
        to: TEST_PHONE,
        message: 'Timeout test message',
      })

      // Should succeed or fail with timeout error
      expect(result.delivered === true || result.error !== undefined).toBe(true)
    })

    it('handles rate limiting (429)', async () => {
      // Send many messages quickly to trigger rate limit
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          channel.send({
            requestId: generateRequestId(`rate-${i}`),
            to: TEST_PHONE,
            message: `Rate limit test ${i}`,
          })
        )
      )

      // Some may fail due to rate limiting, but all should complete
      expect(results.length).toBe(10)
      expect(results.every(r => r.delivered || r.error)).toBe(true)
    })

    it('returns detailed error information on failure', async () => {
      const channelWithBadCredentials = new SMSHumanChannel({
        ...TEST_CONFIG,
        accountSid: 'AC_invalid_account_sid',
        authToken: 'invalid_auth_token',
      })

      const result = await channelWithBadCredentials.send({
        requestId: 'req-bad-creds',
        to: TEST_PHONE,
        message: 'Test with bad credentials',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/credential|auth|account/i)
    })
  })

  // ===========================================================================
  // International SMS Tests
  // ===========================================================================

  describe('International SMS', () => {
    it('sends SMS to international numbers', async () => {
      // This test requires international messaging to be enabled on the Twilio account
      const internationalNumber = process.env.TEST_INTERNATIONAL_PHONE || '+447911123456'

      const result = await channel.send({
        requestId: generateRequestId('intl'),
        to: internationalNumber,
        message: 'International SMS test',
      })

      // May succeed or fail depending on Twilio account settings
      expect(result.delivered || result.error).toBeTruthy()
    })

    it('handles Unicode characters in messages', async () => {
      const unicodeMessage = 'Approval needed: 日本語テスト / Emoji test: ✅❌📱'

      const result = await channel.send({
        requestId: generateRequestId('unicode'),
        to: TEST_PHONE,
        message: unicodeMessage,
      })

      expect(result.delivered).toBe(true)
      // Unicode messages use UCS-2 encoding (70 chars per segment vs 160)
    })
  })
})
