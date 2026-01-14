import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SendGridClient,
  validateSendGridRequest,
  convertSendGridToMessages,
} from '../sendgrid-compat'
import type { SendGridMailRequest } from '../types'

describe('SendGrid Compatibility', () => {
  describe('validateSendGridRequest', () => {
    it('should validate a minimal valid request', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test Subject',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should reject missing personalizations', () => {
      const request = {
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      } as SendGridMailRequest

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('personalizations')
    })

    it('should reject empty personalizations', () => {
      const request: SendGridMailRequest = {
        personalizations: [],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
    })

    it('should reject personalizations without to', () => {
      const request = {
        personalizations: [{ cc: [{ email: 'cc@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      } as SendGridMailRequest

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toContain('to')
    })

    it('should reject missing from', () => {
      const request = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      } as SendGridMailRequest

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('from')
    })

    it('should reject missing subject (without template)', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('subject')
    })

    it('should accept personalization-level subject', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }], subject: 'Custom Subject' }],
        from: { email: 'sender@example.com' },
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should accept template_id without content', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        template_id: 'd-xxxx',
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(true)
    })

    it('should reject invalid from email', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'invalid-email' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const result = validateSendGridRequest(request)
      expect(result.valid).toBe(false)
      expect(result.errors?.errors[0].field).toBe('from.email')
    })
  })

  describe('convertSendGridToMessages', () => {
    it('should convert a simple request to messages', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com', name: 'User' }] }],
        from: { email: 'sender@example.com', name: 'Sender' },
        subject: 'Test Subject',
        content: [{ type: 'text/html', value: '<p>Hello</p>' }],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages).toHaveLength(1)
      expect(messages[0].to).toEqual([{ email: 'user@example.com', name: 'User' }])
      expect(messages[0].from).toEqual({ email: 'sender@example.com', name: 'Sender' })
      expect(messages[0].subject).toBe('Test Subject')
      expect(messages[0].html).toBe('<p>Hello</p>')
    })

    it('should convert multiple personalizations to multiple messages', () => {
      const request: SendGridMailRequest = {
        personalizations: [
          { to: [{ email: 'user1@example.com' }] },
          { to: [{ email: 'user2@example.com' }] },
          { to: [{ email: 'user3@example.com' }] },
        ],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages).toHaveLength(3)
      expect(messages[0].to[0].email).toBe('user1@example.com')
      expect(messages[1].to[0].email).toBe('user2@example.com')
      expect(messages[2].to[0].email).toBe('user3@example.com')
    })

    it('should apply substitutions', () => {
      const request: SendGridMailRequest = {
        personalizations: [
          {
            to: [{ email: 'user@example.com' }],
            substitutions: { '{{name}}': 'John', '{{company}}': 'Acme' },
          },
        ],
        from: { email: 'sender@example.com' },
        subject: 'Hello {{name}}!',
        content: [{ type: 'text/plain', value: 'Welcome to {{company}}, {{name}}!' }],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].subject).toBe('Hello John!')
      expect(messages[0].text).toBe('Welcome to Acme, John!')
    })

    it('should handle CC and BCC', () => {
      const request: SendGridMailRequest = {
        personalizations: [
          {
            to: [{ email: 'user@example.com' }],
            cc: [{ email: 'cc@example.com' }],
            bcc: [{ email: 'bcc@example.com' }],
          },
        ],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].cc).toEqual([{ email: 'cc@example.com' }])
      expect(messages[0].bcc).toEqual([{ email: 'bcc@example.com' }])
    })

    it('should handle reply_to', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        reply_to: { email: 'reply@example.com', name: 'Reply' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].reply_to).toEqual([{ email: 'reply@example.com', name: 'Reply' }])
    })

    it('should handle scheduled sending', () => {
      const sendAt = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
        send_at: sendAt,
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].scheduled_at).toBeDefined()
      expect(messages[0].scheduled_at?.getTime()).toBe(sendAt * 1000)
    })

    it('should handle attachments', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
        attachments: [
          {
            content: 'SGVsbG8gV29ybGQ=',
            filename: 'hello.txt',
            type: 'text/plain',
            disposition: 'attachment',
          },
        ],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].attachments).toHaveLength(1)
      expect(messages[0].attachments?.[0].filename).toBe('hello.txt')
    })

    it('should handle categories and custom_args as tags', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
        categories: ['newsletter', 'promo'],
        custom_args: { campaign_id: '12345' },
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].tags).toMatchObject({
        category_0: 'newsletter',
        category_1: 'promo',
        campaign_id: '12345',
      })
    })

    it('should handle both text and HTML content', () => {
      const request: SendGridMailRequest = {
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [
          { type: 'text/plain', value: 'Hello World' },
          { type: 'text/html', value: '<p>Hello World</p>' },
        ],
      }

      const messages = convertSendGridToMessages(request)
      expect(messages[0].text).toBe('Hello World')
      expect(messages[0].html).toBe('<p>Hello World</p>')
    })
  })

  describe('SendGridClient', () => {
    let originalFetch: typeof globalThis.fetch

    beforeEach(() => {
      originalFetch = globalThis.fetch
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should send email successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        status: 202,
        headers: new Headers({ 'x-message-id': 'msg-123' }),
      })

      const client = new SendGridClient({ apiKey: 'SG.test' })
      const response = await client.send({
        personalizations: [{ to: [{ email: 'user@example.com' }] }],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      })

      expect(response.statusCode).toBe(202)
    })

    it('should return 400 for invalid request', async () => {
      const client = new SendGridClient()
      const response = await client.send({
        personalizations: [],
        from: { email: 'sender@example.com' },
        subject: 'Test',
        content: [{ type: 'text/plain', value: 'Hello' }],
      })

      expect(response.statusCode).toBe(400)
    })
  })
})
