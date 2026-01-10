import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailChannel, renderApprovalEmail, renderNotificationEmail } from '../email'

describe('Email Channel', () => {
  let mockSendGrid: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSendGrid = vi.fn().mockResolvedValue({ statusCode: 202, body: {} })
  })

  describe('renderApprovalEmail()', () => {
    it('should render HTML approval email', () => {
      const html = renderApprovalEmail({
        message: 'Please approve this expense report',
        requestId: 'req-123',
        baseUrl: 'https://app.dotdo.dev',
      })

      expect(html).toContain('Please approve this expense report')
      expect(html).toContain('href="https://app.dotdo.dev/approve/req-123?action=approve"')
      expect(html).toContain('href="https://app.dotdo.dev/approve/req-123?action=reject"')
    })

    it('should include requester info', () => {
      const html = renderApprovalEmail({
        message: 'Approve request',
        requestId: 'req-123',
        metadata: {
          requester: 'john@example.com',
          amount: '$5,000',
          category: 'Travel',
        },
      })

      expect(html).toContain('john@example.com')
      expect(html).toContain('$5,000')
    })

    it('should be mobile-responsive', () => {
      const html = renderApprovalEmail({
        message: 'Test',
        requestId: 'req-123',
      })

      expect(html).toContain('viewport')
      expect(html).toContain('max-width')
    })

    it('should include plain text fallback', () => {
      const { html, text } = renderApprovalEmail({
        message: 'Approve this?',
        requestId: 'req-123',
        returnBoth: true,
      })

      expect(text).toContain('Approve this?')
      expect(text).toContain('https://')
    })
  })

  describe('renderNotificationEmail()', () => {
    it('should render notification without actions', () => {
      const html = renderNotificationEmail({
        subject: 'Update',
        message: 'Your request was approved!',
      })

      expect(html).toContain('Your request was approved!')
      expect(html).not.toContain('action=approve')
    })
  })

  describe('EmailChannel', () => {
    it('should send email via SendGrid', async () => {
      const channel = new EmailChannel({
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@dotdo.dev',
      })

      const result = await channel.send({
        message: 'Approve?',
        to: 'manager@example.com',
        subject: 'Approval Required',
      })

      expect(result.delivered).toBe(true)
    })

    it('should send email via Resend', async () => {
      const channel = new EmailChannel({
        provider: 'resend',
        apiKey: 're_xxx',
        from: 'noreply@dotdo.dev',
      })

      const result = await channel.send({
        message: 'Test',
        to: 'user@example.com',
        subject: 'Test',
      })

      expect(result.delivered).toBe(true)
    })

    it('should handle email response via webhook', async () => {
      const channel = new EmailChannel({
        provider: 'sendgrid',
        apiKey: 'SG.xxx',
        from: 'noreply@dotdo.dev',
      })

      const webhook = {
        event: 'click',
        url: 'https://app.dotdo.dev/approve/req-123?action=approve',
        email: 'manager@example.com',
        timestamp: Date.now(),
      }

      const response = await channel.handleWebhook(webhook)
      expect(response).toMatchObject({
        action: 'approve',
        requestId: 'req-123',
        userId: 'manager@example.com',
      })
    })
  })
})
