import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Resend,
  ResendAPIError,
  validateResendRequest,
  convertResendToMessage,
} from '../resend-compat'
import type { ResendEmailRequest } from '../types'

describe('Resend Compatibility', () => {
  describe('validateResendRequest', () => {
    it('should validate a minimal valid request', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }

      const result = validateResendRequest(request)
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should accept text content', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test Subject',
        text: 'Hello',
      }

      const result = validateResendRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should accept array of recipients', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }

      const result = validateResendRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should reject missing from', () => {
      const request = {
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      } as ResendEmailRequest

      const result = validateResendRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error?.message).toContain('from')
    })

    it('should reject missing to', () => {
      const request = {
        from: 'sender@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      } as ResendEmailRequest

      const result = validateResendRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error?.message).toContain('to')
    })

    it('should reject missing subject', () => {
      const request = {
        from: 'sender@example.com',
        to: 'user@example.com',
        html: '<p>Hello</p>',
      } as ResendEmailRequest

      const result = validateResendRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error?.message).toContain('subject')
    })

    it('should reject missing content', () => {
      const request = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
      } as ResendEmailRequest

      const result = validateResendRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error?.message).toContain('html')
    })

    it('should reject invalid from email', () => {
      const request: ResendEmailRequest = {
        from: 'invalid-email',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const result = validateResendRequest(request)
      expect(result.valid).toBe(false)
      expect(result.error?.message).toContain('valid email')
    })

    it('should accept "Name <email>" format', () => {
      const request: ResendEmailRequest = {
        from: 'Sender Name <sender@example.com>',
        to: 'User Name <user@example.com>',
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const result = validateResendRequest(request)
      expect(result.valid).toBe(true)
    })
  })

  describe('convertResendToMessage', () => {
    it('should convert a simple request to message', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.from).toEqual({ email: 'sender@example.com' })
      expect(message.to).toEqual([{ email: 'user@example.com' }])
      expect(message.subject).toBe('Test Subject')
      expect(message.html).toBe('<p>Hello</p>')
    })

    it('should parse "Name <email>" format', () => {
      const request: ResendEmailRequest = {
        from: 'Sender Name <sender@example.com>',
        to: 'User Name <user@example.com>',
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.from).toEqual({ name: 'Sender Name', email: 'sender@example.com' })
      expect(message.to).toEqual([{ name: 'User Name', email: 'user@example.com' }])
    })

    it('should handle array of recipients', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: ['user1@example.com', 'User Two <user2@example.com>'],
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.to).toEqual([
        { email: 'user1@example.com' },
        { name: 'User Two', email: 'user2@example.com' },
      ])
    })

    it('should handle CC and BCC', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.cc).toEqual([{ email: 'cc@example.com' }])
      expect(message.bcc).toEqual([
        { email: 'bcc1@example.com' },
        { email: 'bcc2@example.com' },
      ])
    })

    it('should handle reply_to', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        reply_to: 'Reply <reply@example.com>',
        subject: 'Test',
        html: '<p>Hello</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.reply_to).toEqual([{ name: 'Reply', email: 'reply@example.com' }])
    })

    it('should handle headers', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      }

      const message = convertResendToMessage(request)
      expect(message.headers).toEqual({ 'X-Custom-Header': 'custom-value' })
    })

    it('should handle tags', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        tags: [
          { name: 'campaign', value: 'promo' },
          { name: 'source', value: 'newsletter' },
        ],
      }

      const message = convertResendToMessage(request)
      expect(message.tags).toEqual({
        campaign: 'promo',
        source: 'newsletter',
      })
    })

    it('should handle scheduled sending', () => {
      const scheduledAt = new Date(Date.now() + 3600000).toISOString()
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        scheduled_at: scheduledAt,
      }

      const message = convertResendToMessage(request)
      expect(message.scheduled_at).toBeDefined()
      expect(message.scheduled_at?.toISOString()).toBe(scheduledAt)
    })

    it('should handle attachments', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'hello.txt',
            content: 'SGVsbG8gV29ybGQ=',
            content_type: 'text/plain',
          },
        ],
      }

      const message = convertResendToMessage(request)
      expect(message.attachments).toHaveLength(1)
      expect(message.attachments?.[0].filename).toBe('hello.txt')
    })

    it('should handle both text and html', () => {
      const request: ResendEmailRequest = {
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        text: 'Hello World',
        html: '<p>Hello World</p>',
      }

      const message = convertResendToMessage(request)
      expect(message.text).toBe('Hello World')
      expect(message.html).toBe('<p>Hello World</p>')
    })
  })

  describe('Resend client', () => {
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'msg-123' }),
      })

      const resend = new Resend('re_test')
      const response = await resend.emails.send({
        from: 'sender@example.com',
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      })

      expect(response.id).toBeDefined()
    })

    it('should throw ResendAPIError for invalid request', async () => {
      const resend = new Resend()

      await expect(
        resend.emails.send({
          from: 'sender@example.com',
          to: 'user@example.com',
          subject: 'Test',
        } as ResendEmailRequest)
      ).rejects.toThrow(ResendAPIError)
    })

    it('should throw ResendAPIError on provider failure', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      })

      const resend = new Resend('re_test')

      await expect(
        resend.emails.send({
          from: 'sender@example.com',
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        })
      ).rejects.toThrow(ResendAPIError)
    })
  })

  describe('ResendAPIError', () => {
    it('should have correct properties', () => {
      const error = new ResendAPIError({
        statusCode: 422,
        message: 'Validation error',
        name: 'validation_error',
      })

      expect(error.statusCode).toBe(422)
      expect(error.message).toBe('Validation error')
      expect(error.code).toBe('validation_error')
      expect(error.name).toBe('ResendAPIError')
    })
  })
})
