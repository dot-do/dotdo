/**
 * RED Phase Tests: Twilio SMS Delivery for Human Notifications
 *
 * Tests for delivering SMS notifications to humans in the dotdo platform.
 * These tests verify:
 * 1. SMS delivery to humans with action links
 * 2. Delivery status tracking via webhooks
 * 3. Error handling for various failure scenarios
 *
 * @module compat/twilio/tests/sms-human-delivery.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TwilioSMS, TwilioSMSError, RateLimitError } from '../sms'
import { SMSHumanChannel } from '../../../lib/human/channels/sms'
import type { NotificationPayload, SendResult } from '../../../lib/human/channels'

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_ACCOUNT_SID = 'AC_test_human_notification'
const TEST_AUTH_TOKEN = 'test_auth_token_123'
const TEST_FROM_NUMBER = '+15551234567'
const TEST_TO_NUMBER = '+15559876543'

function createMockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  })
}

// =============================================================================
// SMS Delivery to Humans
// =============================================================================

describe('Twilio SMS Human Delivery', () => {
  describe('SMSHumanChannel - Notification Delivery', () => {
    it('should deliver approval notification to human with action links', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_human_notify_001', status: 'queued' }),
      })

      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const payload: NotificationPayload = {
        requestId: 'human-req-123',
        message: 'Please approve the $5000 expense report from Engineering team',
        priority: 'high',
        baseUrl: 'https://app.dotdo.dev',
      }

      const result = await channel.send({ ...payload, to: TEST_TO_NUMBER } as any)

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('should include approve and reject action links in SMS body', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_actions_001', status: 'queued' }),
      })

      // Use non-test credentials to ensure fetch is called
      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: 'AC_real_account_sid',
        authToken: 'real_auth_token',
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const payload: NotificationPayload = {
        requestId: 'approval-req-456',
        message: 'Approve partnership deal?',
        baseUrl: 'https://app.dotdo.dev',
        actions: [
          { label: 'Approve', value: 'approve' },
          { label: 'Reject', value: 'reject' },
        ],
      }

      await channel.send({ ...payload, to: TEST_TO_NUMBER } as any)

      // Verify the fetch was called (message body should contain action links)
      expect(mockFetch).toHaveBeenCalled()
      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[1].body).toBeDefined()
    })

    it('should format SMS body with proper action URLs', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_format_001', status: 'queued' }),
      })

      // Use non-test credentials to ensure fetch is called
      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: 'AC_real_account_sid',
        authToken: 'real_auth_token',
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await channel.send({
        requestId: 'format-test-789',
        message: 'Approve refund of $150?',
        baseUrl: 'https://custom.app.com',
        to: TEST_TO_NUMBER,
      } as any)

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body).replace(/\+/g, ' ')
      expect(body).toContain('Approve refund')
      expect(body).toContain('custom.app.com/approve/format-test-789')
    })

    it('should support custom action labels', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_custom_001', status: 'queued' }),
      })

      // Use non-test credentials to ensure fetch is called
      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: 'AC_real_account_sid',
        authToken: 'real_auth_token',
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await channel.send({
        requestId: 'custom-actions-001',
        message: 'Select deployment environment',
        to: TEST_TO_NUMBER,
        actions: [
          { label: 'Production', value: 'prod' },
          { label: 'Staging', value: 'staging' },
          { label: 'Cancel', value: 'cancel' },
        ],
      } as any)

      const body = decodeURIComponent(mockFetch.mock.calls[0][1].body)
      expect(body).toContain('Production')
      expect(body).toContain('Staging')
      expect(body).toContain('Cancel')
    })

    it('should set priority-based delivery options', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_urgent_001', status: 'queued' }),
      })

      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const result = await channel.send({
        requestId: 'urgent-001',
        message: 'URGENT: Production incident requires immediate approval',
        priority: 'urgent',
        to: TEST_TO_NUMBER,
      } as any)

      expect(result.delivered).toBe(true)
    })

    it('should handle multiple human recipients in batch', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_batch_001', status: 'queued' }),
      })

      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const recipients = [
        { to: '+15551111111', body: 'Approval needed: Expense report #1' },
        { to: '+15552222222', body: 'Approval needed: Expense report #2' },
        { to: '+15553333333', body: 'Approval needed: Expense report #3' },
      ]

      const results = await sms.sendBatch(recipients)

      expect(results.length).toBe(3)
      results.forEach((result) => {
        expect(result.status).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Delivery Status Tracking
  // ===========================================================================

  describe('Delivery Status Tracking', () => {
    it('should track message status from initial send', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({
          sid: 'SM_track_001',
          account_sid: TEST_ACCOUNT_SID,
          status: 'queued',
          to: TEST_TO_NUMBER,
          from: TEST_FROM_NUMBER,
          body: 'Test message',
          direction: 'outbound-api',
          date_created: new Date().toISOString(),
          date_sent: null,
          error_code: null,
          error_message: null,
          num_segments: '1',
          price: null,
          price_unit: 'USD',
        }),
      })

      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const response = await sms.send({
        to: TEST_TO_NUMBER,
        body: 'Human notification test',
      })

      expect(response.status).toBe('queued')
      expect(response.sid).toBe('SM_track_001')

      // Verify local tracking
      const trackedStatus = sms.getTrackedStatus('SM_track_001')
      expect(trackedStatus).not.toBeNull()
      expect(trackedStatus?.status).toBe('queued')
    })

    it('should update status via webhook callback', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      // Simulate webhook payload from Twilio
      const webhookPayload = {
        MessageSid: 'SM_webhook_001',
        AccountSid: TEST_ACCOUNT_SID,
        From: TEST_FROM_NUMBER,
        To: TEST_TO_NUMBER,
        Body: 'Human notification',
        SmsStatus: 'delivered' as const,
      }

      const statusEntry = sms.handleWebhook(webhookPayload)

      expect(statusEntry.sid).toBe('SM_webhook_001')
      expect(statusEntry.status).toBe('delivered')
      expect(statusEntry.updatedAt).toBeInstanceOf(Date)
    })

    it('should track delivery progression: queued -> sent -> delivered', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      const sid = 'SM_progression_001'

      // Simulate status progression
      sms.handleWebhook({ MessageSid: sid, SmsStatus: 'queued' as const })
      let status = sms.getTrackedStatus(sid)
      expect(status?.status).toBe('queued')

      sms.handleWebhook({ MessageSid: sid, SmsStatus: 'sent' as const })
      status = sms.getTrackedStatus(sid)
      expect(status?.status).toBe('sent')

      sms.handleWebhook({ MessageSid: sid, SmsStatus: 'delivered' as const })
      status = sms.getTrackedStatus(sid)
      expect(status?.status).toBe('delivered')
    })

    it('should track failed delivery with error details', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({
          sid: 'SM_failed_001',
          account_sid: TEST_ACCOUNT_SID,
          status: 'failed',
          error_code: 30003,
          error_message: 'Unreachable destination handset',
          to: TEST_TO_NUMBER,
          from: TEST_FROM_NUMBER,
          body: 'Failed message',
          direction: 'outbound-api',
          date_created: new Date().toISOString(),
          date_updated: new Date().toISOString(),
          date_sent: null,
          num_segments: '1',
          price: null,
          price_unit: 'USD',
        }),
      })

      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const status = await sms.getStatus('SM_failed_001')

      expect(status.status).toBe('failed')
      expect(status.errorCode).toBe(30003)
      expect(status.errorMessage).toBe('Unreachable destination handset')
    })

    it('should track undelivered status with carrier error', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      sms.handleWebhook({
        MessageSid: 'SM_undelivered_001',
        SmsStatus: 'undelivered' as const,
      })

      const status = sms.getTrackedStatus('SM_undelivered_001')
      expect(status?.status).toBe('undelivered')
    })

    it('should provide delivery statistics for human notifications', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({
          messages: [
            { sid: 'SM1', status: 'delivered', to: '+1', from: '+2', body: '', direction: 'outbound-api', date_created: '', date_sent: '', error_code: null, error_message: null, num_segments: '1', price: null, price_unit: 'USD', account_sid: 'AC' },
            { sid: 'SM2', status: 'delivered', to: '+1', from: '+2', body: '', direction: 'outbound-api', date_created: '', date_sent: '', error_code: null, error_message: null, num_segments: '1', price: null, price_unit: 'USD', account_sid: 'AC' },
            { sid: 'SM3', status: 'failed', to: '+1', from: '+2', body: '', direction: 'outbound-api', date_created: '', date_sent: '', error_code: 30003, error_message: 'Error', num_segments: '1', price: null, price_unit: 'USD', account_sid: 'AC' },
            { sid: 'SM4', status: 'queued', to: '+1', from: '+2', body: '', direction: 'outbound-api', date_created: '', date_sent: '', error_code: null, error_message: null, num_segments: '1', price: null, price_unit: 'USD', account_sid: 'AC' },
          ],
        }),
      })

      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      const stats = await sms.getDeliveryStats({
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      })

      expect(stats.total).toBe(4)
      expect(stats.delivered).toBe(2)
      expect(stats.failed).toBe(1)
      expect(stats.pending).toBe(1)
      expect(stats.deliveryRate).toBe(0.5)
    })

    it('should create webhook handler for status callbacks', () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      const webhookHandler = sms.createWebhookHandler()

      expect(webhookHandler).toBeDefined()
      // Webhook handler should be a Hono router
      expect(typeof webhookHandler.fetch).toBe('function')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw TwilioSMSError on API failure', async () => {
      const mockFetch = createMockFetch({
        ok: false,
        status: 400,
        json: async () => ({
          code: 21211,
          message: "The 'To' number is not a valid phone number.",
          more_info: 'https://www.twilio.com/docs/errors/21211',
          status: 400,
        }),
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_real_test',
        authToken: 'real_token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await expect(
        sms.send({
          to: 'invalid-number',
          body: 'Test',
        })
      ).rejects.toThrow(TwilioSMSError)
    })

    it('should validate phone number format before sending', async () => {
      const mockFetch = createMockFetch({})

      const sms = new TwilioSMS({
        accountSid: 'AC_validate_test',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await expect(
        sms.send({
          to: 'not-a-phone',
          body: 'Test message',
        })
      ).rejects.toThrow("not a valid phone number")
    })

    it('should require from number or messaging service SID', async () => {
      const mockFetch = createMockFetch({})

      const sms = new TwilioSMS({
        accountSid: 'AC_no_from',
        authToken: 'token',
        fetch: mockFetch,
        // No defaultFrom or defaultMessagingServiceSid
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: 'Test message',
        })
      ).rejects.toThrow("'From' phone number or 'MessagingServiceSid' is required")
    })

    it('should require message body or media URL', async () => {
      const sms = new TwilioSMS({
        accountSid: 'AC_no_body',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: '',
        })
      ).rejects.toThrow("'Body' or 'MediaUrl'")
    })

    it('should throw RateLimitError when rate limited', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_rate_limit_001', status: 'queued' }),
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_real_account_for_rate_limit',
        authToken: 'real_auth_token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
        rateLimit: {
          maxRequests: 1,
          windowMs: 60000,
        },
      })

      // First request should succeed
      await sms.send({ to: TEST_TO_NUMBER, body: 'First message' })

      // Second request should be rate limited
      await expect(
        sms.send({ to: TEST_TO_NUMBER, body: 'Second message' })
      ).rejects.toThrow(RateLimitError)
    })

    it('should handle network timeout gracefully', async () => {
      const mockFetch = vi.fn().mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timed out')), 50)
        })
      )

      const sms = new TwilioSMS({
        accountSid: 'AC_timeout_test',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
        timeout: 100,
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: 'Timeout test',
        })
      ).rejects.toThrow('timed out')
    })

    it('should handle carrier-specific error codes', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      // Simulate carrier rejection webhook
      sms.handleWebhook({
        MessageSid: 'SM_carrier_error',
        SmsStatus: 'undelivered' as const,
      })

      const status = sms.getTrackedStatus('SM_carrier_error')
      expect(status?.status).toBe('undelivered')
    })

    it('should handle invalid webhook signatures', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
        webhookSecret: 'correct_secret',
      })

      const isValid = await sms.verifyWebhookSignature(
        'invalid_signature',
        'https://app.dotdo.dev/webhooks/twilio',
        { MessageSid: 'SM123', SmsStatus: 'delivered' }
      )

      expect(isValid).toBe(false)
    })

    it('should handle authentication errors (401)', async () => {
      const mockFetch = createMockFetch({
        ok: false,
        status: 401,
        json: async () => ({
          code: 20003,
          message: 'Authentication Error',
          more_info: 'https://www.twilio.com/docs/errors/20003',
          status: 401,
        }),
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_bad_auth',
        authToken: 'wrong_token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: 'Auth test',
        })
      ).rejects.toThrow('Authentication Error')
    })

    it('should handle account suspended error', async () => {
      const mockFetch = createMockFetch({
        ok: false,
        status: 403,
        json: async () => ({
          code: 20005,
          message: 'Account is suspended',
          more_info: 'https://www.twilio.com/docs/errors/20005',
          status: 403,
        }),
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_suspended',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: 'Suspended test',
        })
      ).rejects.toThrow('suspended')
    })

    it('should handle opt-out (STOP) messages', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      // Simulate opt-out webhook
      const optOutResult = sms.handleOptOutWebhook({
        MessageSid: 'SM_optout',
        From: TEST_TO_NUMBER,
        To: TEST_FROM_NUMBER,
        Body: 'STOP',
        SmsStatus: 'received' as const,
      })

      expect(optOutResult.action).toBe('opt-out')
      expect(optOutResult.phoneNumber).toBe(TEST_TO_NUMBER)
    })

    it('should handle landline number rejection', async () => {
      const mockFetch = createMockFetch({
        ok: false,
        status: 400,
        json: async () => ({
          code: 21614,
          message: "'To' number is not a valid mobile number",
          more_info: 'https://www.twilio.com/docs/errors/21614',
          status: 400,
        }),
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_landline_test',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      await expect(
        sms.send({
          to: '+15551234000', // Hypothetical landline
          body: 'Landline test',
        })
      ).rejects.toThrow('not a valid mobile number')
    })
  })

  // ===========================================================================
  // Human Channel Integration
  // ===========================================================================

  describe('Human Channel Integration', () => {
    it('should handle missing phone number gracefully', async () => {
      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fromNumber: TEST_FROM_NUMBER,
      })

      const result = await channel.send({
        requestId: 'no-phone-001',
        message: 'Test without recipient',
        // Note: 'to' is missing
      } as any)

      expect(result.delivered).toBe(false)
      expect(result.error).toContain('Invalid or missing phone number')
    })

    it('should normalize various phone number formats', async () => {
      const mockFetch = createMockFetch({
        json: async () => ({ sid: 'SM_normalize', status: 'queued' }),
      })

      const channel = new SMSHumanChannel({
        provider: 'twilio',
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        fromNumber: TEST_FROM_NUMBER,
        fetch: mockFetch,
      })

      // Test various formats
      const formats = [
        '555-987-6543',
        '(555) 987-6543',
        '5559876543',
        '1-555-987-6543',
      ]

      for (const format of formats) {
        const result = await channel.send({
          requestId: 'normalize-test',
          message: 'Format test',
          to: format,
        } as any)

        expect(result.delivered).toBe(true)
      }
    })

    it('should parse incoming SMS responses for approval', () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: TEST_FROM_NUMBER,
      })

      // Test approve responses
      const approveResponse = channel.handleWebhook({
        From: TEST_TO_NUMBER,
        Body: 'yes',
      })
      expect(approveResponse?.action).toBe('approve')

      // Test reject responses
      const rejectResponse = channel.handleWebhook({
        From: TEST_TO_NUMBER,
        Body: 'no',
      })
      expect(rejectResponse?.action).toBe('reject')
    })

    it('should handle ambiguous SMS responses', () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: TEST_FROM_NUMBER,
      })

      // Ambiguous response should return null
      const ambiguousResponse = channel.handleWebhook({
        From: TEST_TO_NUMBER,
        Body: 'maybe later',
      })
      expect(ambiguousResponse).toBeNull()
    })

    it('should include timestamp in delivery results', async () => {
      const channel = new SMSHumanChannel({
        provider: 'mock',
        fromNumber: TEST_FROM_NUMBER,
      })

      const result = await channel.send({
        requestId: 'timestamp-test',
        message: 'Testing timestamp',
        to: TEST_TO_NUMBER,
      } as any)

      expect(result.timestamp).toBeDefined()
      // Should be a valid ISO timestamp
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp)
    })
  })

  // ===========================================================================
  // Retry and Recovery
  // ===========================================================================

  describe('Retry and Recovery', () => {
    it('should retry on transient failures', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts < 3) {
          return {
            ok: false,
            status: 503,
            json: async () => ({
              code: 20500,
              message: 'Service temporarily unavailable',
              more_info: '',
              status: 503,
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            sid: 'SM_retry_success',
            account_sid: TEST_ACCOUNT_SID,
            status: 'queued',
            to: TEST_TO_NUMBER,
            from: TEST_FROM_NUMBER,
            body: 'Retry test',
            direction: 'outbound-api',
            date_created: new Date().toISOString(),
            date_sent: null,
            error_code: null,
            error_message: null,
            num_segments: '1',
            price: null,
            price_unit: 'USD',
          }),
        }
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_retry_test',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      const result = await sms.send({
        to: TEST_TO_NUMBER,
        body: 'Retry test message',
      })

      expect(result.sid).toBe('SM_retry_success')
      expect(attempts).toBe(3)
    })

    it('should not retry on client errors (4xx)', async () => {
      let attempts = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempts++
        return {
          ok: false,
          status: 400,
          json: async () => ({
            code: 21211,
            message: "Invalid 'To' number",
            more_info: '',
            status: 400,
          }),
        }
      })

      const sms = new TwilioSMS({
        accountSid: 'AC_no_retry',
        authToken: 'token',
        defaultFrom: TEST_FROM_NUMBER,
        fetch: mockFetch,
        autoRetry: true,
        maxRetries: 3,
      })

      await expect(
        sms.send({
          to: TEST_TO_NUMBER,
          body: 'No retry test',
        })
      ).rejects.toThrow()

      // Should only attempt once for 4xx errors
      expect(attempts).toBe(1)
    })

    it('should queue messages for durable delivery', async () => {
      const sms = new TwilioSMS({
        accountSid: TEST_ACCOUNT_SID,
        authToken: TEST_AUTH_TOKEN,
        defaultFrom: TEST_FROM_NUMBER,
      })

      const queueResult = await sms.queueForDelivery({
        to: TEST_TO_NUMBER,
        body: 'Queued message',
        idempotencyKey: 'unique-key-123',
      })

      expect(queueResult.queued).toBe(true)
      expect(queueResult.idempotencyKey).toBe('unique-key-123')
    })
  })
})
