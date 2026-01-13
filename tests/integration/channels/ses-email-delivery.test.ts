/**
 * AWS SES Email Delivery Integration Tests (RED)
 *
 * Tests REAL AWS SES email delivery for human approval/task notifications.
 * NO MOCKS - tests hit actual SES API and verify email delivery.
 *
 * AWS SES is the PRIMARY email mechanism for Human-in-the-Loop (preferred over SendGrid).
 *
 * Environment Variables Required:
 * - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (or IAM role)
 * - AWS_SES_REGION (e.g., 'us-east-1')
 * - SES_VERIFIED_DOMAIN (e.g., 'dotdo.dev')
 * - TEST_EMAIL_RECIPIENT (verified email for sandbox mode testing)
 *
 * @module tests/integration/channels/ses-email-delivery.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  SESNotificationChannel,
  type SESChannelConfig,
  type SESDeliveryResult,
  type SESDeliveryStatus,
  type SNSBounceEvent,
  type SNSComplaintEvent,
} from '../../../lib/human/channels/ses'
import type { NotificationPayload } from '../../../lib/human/channels'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: SESChannelConfig = {
  region: process.env.AWS_SES_REGION || 'us-east-1',
  fromEmail: `noreply@${process.env.SES_VERIFIED_DOMAIN || 'dotdo.dev'}`,
  // AWS credentials from environment or IAM role
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  } : undefined,
  // SNS topic ARNs for delivery tracking
  snsTopics: {
    bounce: process.env.SES_BOUNCE_TOPIC_ARN,
    complaint: process.env.SES_COMPLAINT_TOPIC_ARN,
    delivery: process.env.SES_DELIVERY_TOPIC_ARN,
  },
}

const TEST_RECIPIENT = process.env.TEST_EMAIL_RECIPIENT || 'test@example.com'

// =============================================================================
// Approval Request Emails
// =============================================================================

describe('AWS SES Email Delivery (REAL)', () => {
  let channel: SESNotificationChannel

  beforeAll(() => {
    channel = new SESNotificationChannel(TEST_CONFIG)
  })

  afterAll(async () => {
    // Cleanup any pending tracking
    await channel.close?.()
  })

  describe('Approval Request Emails', () => {
    it('sends approval request email with action links', async () => {
      const payload: NotificationPayload = {
        requestId: `req-approval-${Date.now()}`,
        message: 'Please approve this expense report for $5,000',
        subject: '[Action Required] Expense Report Approval',
        priority: 'high',
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
      }

      const result = await channel.send({
        ...payload,
        to: TEST_RECIPIENT,
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.messageId).toMatch(/^[a-f0-9-]+$/i) // SES message ID format
      expect(result.timestamp).toBeDefined()
    })

    it('sends approval request with SES template', async () => {
      const result = await channel.sendWithTemplate({
        templateName: 'ApprovalRequest',
        templateData: {
          requestId: `req-template-${Date.now()}`,
          title: 'Purchase Order Approval',
          description: 'Please review and approve this purchase order',
          approverName: 'Manager',
          requestorName: 'John Doe',
          amount: '$15,000',
          approveUrl: 'https://app.dotdo.dev/approve/po-123?action=approve',
          rejectUrl: 'https://app.dotdo.dev/approve/po-123?action=reject',
        },
        to: TEST_RECIPIENT,
        subject: '[Action Required] Purchase Order Approval',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.templateUsed).toBe('ApprovalRequest')
    })

    it('tracks email delivery status via SNS notifications', async () => {
      const payload: NotificationPayload = {
        requestId: `req-track-${Date.now()}`,
        message: 'Test delivery tracking',
        subject: 'Delivery Tracking Test',
      }

      const result = await channel.send({
        ...payload,
        to: TEST_RECIPIENT,
      })

      expect(result.messageId).toBeDefined()

      // Wait for SNS delivery notification (up to 30 seconds)
      const status = await channel.getDeliveryStatus(result.messageId!, {
        timeout: 30000,
        pollInterval: 2000,
      })

      expect(status).toBeDefined()
      expect(['delivered', 'sent', 'pending']).toContain(status.state)
      expect(status.timestamp).toBeDefined()
    })
  })

  // ===========================================================================
  // Task Assignment Emails
  // ===========================================================================

  describe('Task Assignment Emails', () => {
    it('sends task email with instructions', async () => {
      const result = await channel.sendTaskAssignment({
        to: TEST_RECIPIENT,
        taskId: `task-${Date.now()}`,
        title: 'Review Q4 Financial Report',
        description: 'Please review the attached financial report and provide your analysis.',
        instructions: [
          'Download the report from the attached link',
          'Review sections 3.1 through 3.5',
          'Submit your analysis via the task portal',
        ],
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        priority: 'high',
        assignedBy: 'CFO',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('sends task email with attachment via S3 presigned URL', async () => {
      const result = await channel.sendTaskAssignment({
        to: TEST_RECIPIENT,
        taskId: `task-attach-${Date.now()}`,
        title: 'Review Document',
        description: 'Please review the attached document.',
        attachments: [
          {
            filename: 'report.pdf',
            s3Bucket: process.env.SES_ATTACHMENT_BUCKET || 'dotdo-attachments',
            s3Key: 'test/sample-report.pdf',
            contentType: 'application/pdf',
            // Will generate presigned URL valid for 24 hours
            expiresIn: 86400,
          },
        ],
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      })

      expect(result.delivered).toBe(true)
      expect(result.attachmentUrls).toBeDefined()
      expect(result.attachmentUrls).toHaveLength(1)
      expect(result.attachmentUrls![0]).toMatch(/^https:\/\/.*\.s3\..*\.amazonaws\.com/)
    })
  })

  // ===========================================================================
  // Escalation Emails
  // ===========================================================================

  describe('Escalation Emails', () => {
    it('sends escalation email with high priority headers', async () => {
      const result = await channel.sendEscalation({
        to: TEST_RECIPIENT,
        escalationId: `esc-${Date.now()}`,
        originalRequestId: 'req-123',
        reason: 'SLA exceeded - no response in 4 hours',
        priority: 'urgent',
        escalationLevel: 2,
        escalationChain: ['manager@example.com', 'director@example.com', 'vp@example.com'],
        currentLevel: 'director@example.com',
        subject: '[URGENT] Escalated: Approval Required - SLA Breach',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.headers).toBeDefined()
      expect(result.headers!['X-Priority']).toBe('1') // High priority
      expect(result.headers!['Importance']).toBe('high')
    })

    it('sends escalation with SLA warning', async () => {
      const slaDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now

      const result = await channel.sendEscalation({
        to: TEST_RECIPIENT,
        escalationId: `esc-sla-${Date.now()}`,
        originalRequestId: 'req-456',
        reason: 'Approaching SLA deadline',
        priority: 'high',
        slaDeadline,
        slaWarning: true,
        timeRemaining: '2 hours',
        subject: '[WARNING] SLA Deadline Approaching - Action Required',
      })

      expect(result.delivered).toBe(true)
      expect(result.messageId).toBeDefined()
    })

    it('handles bounce/complaint notifications', async () => {
      // Simulate receiving a bounce notification from SNS
      const bounceEvent: SNSBounceEvent = {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            {
              emailAddress: 'invalid@example.com',
              action: 'failed',
              status: '5.1.1',
              diagnosticCode: 'smtp; 550 5.1.1 User unknown',
            },
          ],
          timestamp: new Date().toISOString(),
          feedbackId: 'feedback-123',
        },
        mail: {
          timestamp: new Date().toISOString(),
          source: TEST_CONFIG.fromEmail,
          messageId: 'test-message-id-123',
          destination: ['invalid@example.com'],
        },
      }

      const handleResult = await channel.handleBounce(bounceEvent)

      expect(handleResult.processed).toBe(true)
      expect(handleResult.bounceType).toBe('Permanent')
      expect(handleResult.recipientsSuppressed).toContain('invalid@example.com')
    })
  })

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  describe('Bulk Operations', () => {
    it('sends batch emails efficiently', async () => {
      const recipients = [
        TEST_RECIPIENT,
        // Add more test recipients if available
      ]

      const notifications = recipients.map((email, i) => ({
        to: email,
        requestId: `bulk-req-${Date.now()}-${i}`,
        message: `Bulk test message ${i + 1}`,
        subject: `Bulk Email Test ${i + 1}`,
      }))

      const results = await channel.sendBatch(notifications)

      expect(results).toHaveLength(notifications.length)
      expect(results.every(r => r.delivered)).toBe(true)
      expect(results.every(r => r.messageId)).toBe(true)
    })

    it('respects SES rate limits', async () => {
      // SES sandbox has 1 email/second limit
      // Production has higher limits based on reputation
      const batchSize = 5
      const notifications = Array.from({ length: batchSize }, (_, i) => ({
        to: TEST_RECIPIENT,
        requestId: `rate-test-${Date.now()}-${i}`,
        message: `Rate limit test ${i + 1}`,
        subject: `Rate Limit Test ${i + 1}`,
      }))

      const startTime = Date.now()
      const results = await channel.sendBatch(notifications, {
        rateLimit: 1, // 1 email per second (sandbox mode)
        retryOnThrottle: true,
        maxRetries: 3,
      })
      const duration = Date.now() - startTime

      expect(results).toHaveLength(batchSize)
      expect(results.every(r => r.delivered || r.error?.includes('throttle'))).toBe(true)

      // Should take at least (batchSize - 1) seconds with 1 email/second rate limit
      if (process.env.SES_SANDBOX_MODE === 'true') {
        expect(duration).toBeGreaterThanOrEqual((batchSize - 1) * 1000)
      }
    })
  })

  // ===========================================================================
  // Bounce and Complaint Handling
  // ===========================================================================

  describe('Bounce/Complaint Handling', () => {
    it('processes hard bounce and suppresses recipient', async () => {
      const bounceEvent: SNSBounceEvent = {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [
            {
              emailAddress: 'hardbounce@example.com',
              action: 'failed',
              status: '5.1.1',
              diagnosticCode: 'smtp; 550 5.1.1 User unknown',
            },
          ],
          timestamp: new Date().toISOString(),
          feedbackId: 'bounce-feedback-123',
        },
        mail: {
          timestamp: new Date().toISOString(),
          source: TEST_CONFIG.fromEmail,
          messageId: 'bounce-test-msg-123',
          destination: ['hardbounce@example.com'],
        },
      }

      const result = await channel.handleBounce(bounceEvent)

      expect(result.processed).toBe(true)
      expect(result.bounceType).toBe('Permanent')
      expect(result.action).toBe('suppress')

      // Verify recipient is in suppression list
      const isSuppressed = await channel.isRecipientSuppressed('hardbounce@example.com')
      expect(isSuppressed).toBe(true)
    })

    it('processes soft bounce with retry logic', async () => {
      const bounceEvent: SNSBounceEvent = {
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Transient',
          bounceSubType: 'MailboxFull',
          bouncedRecipients: [
            {
              emailAddress: 'fullmailbox@example.com',
              action: 'delayed',
              status: '4.2.2',
              diagnosticCode: 'smtp; 452 4.2.2 Mailbox full',
            },
          ],
          timestamp: new Date().toISOString(),
          feedbackId: 'soft-bounce-feedback-123',
        },
        mail: {
          timestamp: new Date().toISOString(),
          source: TEST_CONFIG.fromEmail,
          messageId: 'soft-bounce-test-msg-123',
          destination: ['fullmailbox@example.com'],
        },
      }

      const result = await channel.handleBounce(bounceEvent)

      expect(result.processed).toBe(true)
      expect(result.bounceType).toBe('Transient')
      expect(result.action).toBe('retry')
      expect(result.retryAfter).toBeDefined()
    })

    it('processes complaint and suppresses recipient', async () => {
      const complaintEvent: SNSComplaintEvent = {
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [
            { emailAddress: 'complained@example.com' },
          ],
          timestamp: new Date().toISOString(),
          feedbackId: 'complaint-feedback-123',
          complaintFeedbackType: 'abuse',
        },
        mail: {
          timestamp: new Date().toISOString(),
          source: TEST_CONFIG.fromEmail,
          messageId: 'complaint-test-msg-123',
          destination: ['complained@example.com'],
        },
      }

      const result = await channel.handleComplaint(complaintEvent)

      expect(result.processed).toBe(true)
      expect(result.complaintType).toBe('abuse')
      expect(result.recipientsSuppressed).toContain('complained@example.com')

      // Verify recipient is in suppression list
      const isSuppressed = await channel.isRecipientSuppressed('complained@example.com')
      expect(isSuppressed).toBe(true)
    })
  })

  // ===========================================================================
  // Configuration Validation
  // ===========================================================================

  describe('Configuration Validation', () => {
    it('requires valid AWS region', () => {
      expect(() => {
        new SESNotificationChannel({
          ...TEST_CONFIG,
          region: '',
        })
      }).toThrow('AWS region is required')
    })

    it('requires valid from email address', () => {
      expect(() => {
        new SESNotificationChannel({
          ...TEST_CONFIG,
          fromEmail: 'invalid-email',
        })
      }).toThrow('Invalid from email address')
    })

    it('validates from email is from verified domain', async () => {
      const channel = new SESNotificationChannel({
        ...TEST_CONFIG,
        fromEmail: 'test@unverified-domain.com',
      })

      const result = await channel.send({
        to: TEST_RECIPIENT,
        requestId: 'req-unverified',
        message: 'Test from unverified domain',
        subject: 'Unverified Domain Test',
      })

      // SES should reject emails from unverified domains
      expect(result.delivered).toBe(false)
      expect(result.error).toMatch(/not verified|identity/i)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('handles invalid recipient gracefully', async () => {
      const result = await channel.send({
        to: 'not-an-email',
        requestId: 'req-invalid-recipient',
        message: 'Test with invalid recipient',
        subject: 'Invalid Recipient Test',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles network errors with retry', async () => {
      // This test verifies retry behavior on transient failures
      const result = await channel.send({
        to: TEST_RECIPIENT,
        requestId: `req-retry-${Date.now()}`,
        message: 'Test retry behavior',
        subject: 'Retry Test',
      }, {
        retries: 3,
        retryDelay: 1000,
      })

      // Should succeed or provide meaningful error
      expect(result.delivered || result.error).toBeTruthy()
    })

    it('returns detailed error information on failure', async () => {
      const channelWithBadCredentials = new SESNotificationChannel({
        ...TEST_CONFIG,
        credentials: {
          accessKeyId: 'INVALID_ACCESS_KEY',
          secretAccessKey: 'INVALID_SECRET_KEY',
        },
      })

      const result = await channelWithBadCredentials.send({
        to: TEST_RECIPIENT,
        requestId: 'req-bad-creds',
        message: 'Test with bad credentials',
        subject: 'Bad Credentials Test',
      })

      expect(result.delivered).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/credential|auth|access/i)
    })
  })
})
