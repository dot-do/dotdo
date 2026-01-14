/**
 * SendGrid v2 Adapter-based Implementation Tests
 *
 * Tests the new adapter-based SendGrid SDK implementation
 * for API compatibility with @sendgrid/mail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import sgMail, { MailService, ResponseError } from '../index'

// Mock the SendGridClient
vi.mock('../../../emails/sendgrid-compat', () => ({
  SendGridClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      statusCode: 202,
      headers: { 'x-message-id': 'test-message-id' },
    }),
  })),
  validateSendGridRequest: vi.fn().mockReturnValue({ valid: true }),
}))

describe('SendGrid v2 Adapter', () => {
  let mailService: MailService

  beforeEach(() => {
    mailService = new MailService()
    mailService.setApiKey('SG_test_key')
    vi.clearAllMocks()
  })

  describe('setApiKey', () => {
    it('should set API key', () => {
      const service = new MailService()
      expect(() => service.setApiKey('SG_xxx')).not.toThrow()
    })
  })

  describe('send()', () => {
    it('should send a simple email', async () => {
      const [response] = await mailService.send({
        to: 'user@example.com',
        from: 'noreply@example.com',
        subject: 'Hello',
        text: 'Hello World',
      })

      expect(response.statusCode).toBe(202)
      expect(response.headers['x-message-id']).toBeDefined()
    })

    it('should send email with HTML content', async () => {
      const [response] = await mailService.send({
        to: 'user@example.com',
        from: 'noreply@example.com',
        subject: 'Hello',
        html: '<h1>Hello World</h1>',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should handle multiple recipients', async () => {
      const [response] = await mailService.send({
        to: ['user1@example.com', 'user2@example.com'],
        from: 'noreply@example.com',
        subject: 'Newsletter',
        text: 'News...',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should handle email address with name', async () => {
      const [response] = await mailService.send({
        to: { email: 'user@example.com', name: 'Test User' },
        from: { email: 'noreply@example.com', name: 'Service' },
        subject: 'Hello',
        text: 'Hello World',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should parse name from string format', async () => {
      const [response] = await mailService.send({
        to: 'Test User <user@example.com>',
        from: 'Service <noreply@example.com>',
        subject: 'Hello',
        text: 'Hello World',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should handle template emails', async () => {
      const [response] = await mailService.send({
        to: 'user@example.com',
        from: 'noreply@example.com',
        templateId: 'd-xxxxxxxxxxxxx',
        dynamicTemplateData: {
          name: 'John',
          orderNumber: '12345',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should handle personalizations', async () => {
      const [response] = await mailService.send({
        personalizations: [
          { to: [{ email: 'user1@example.com', name: 'User 1' }], dynamicTemplateData: { name: 'User 1' } },
          { to: [{ email: 'user2@example.com', name: 'User 2' }], dynamicTemplateData: { name: 'User 2' } },
        ],
        from: 'noreply@example.com',
        templateId: 'd-welcome',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should send array of emails', async () => {
      const [response] = await mailService.send([
        {
          to: 'user1@example.com',
          from: 'noreply@example.com',
          subject: 'Email 1',
          text: 'Content 1',
        },
        {
          to: 'user2@example.com',
          from: 'noreply@example.com',
          subject: 'Email 2',
          text: 'Content 2',
        },
      ])

      expect(response.statusCode).toBe(202)
    })
  })

  describe('sendMultiple()', () => {
    it('should send separate email to each recipient', async () => {
      const [response] = await mailService.sendMultiple({
        to: ['user1@example.com', 'user2@example.com'],
        from: 'sender@example.com',
        subject: 'Personal message',
        text: 'This goes to each recipient separately.',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should handle isMultiple flag in mail data', async () => {
      const [response] = await mailService.send({
        to: ['user1@example.com', 'user2@example.com'],
        from: 'sender@example.com',
        subject: 'Personal message',
        text: 'This goes to each recipient separately.',
        isMultiple: true,
      })

      expect(response.statusCode).toBe(202)
    })
  })

  describe('Error handling', () => {
    it('should throw ResponseError when API key not set', async () => {
      const service = new MailService()

      await expect(
        service.send({
          to: 'user@example.com',
          from: 'noreply@example.com',
          subject: 'Hello',
          text: 'Hello World',
        })
      ).rejects.toThrow(ResponseError)
    })

    it('should throw ResponseError when to field is missing', async () => {
      await expect(
        mailService.send({
          from: 'noreply@example.com',
          subject: 'Hello',
          text: 'Hello World',
        } as any)
      ).rejects.toThrow(ResponseError)
    })
  })

  describe('Default export', () => {
    it('should export default mail service instance', () => {
      expect(sgMail).toBeInstanceOf(MailService)
    })

    it('should have setApiKey method', () => {
      expect(typeof sgMail.setApiKey).toBe('function')
    })

    it('should have send method', () => {
      expect(typeof sgMail.send).toBe('function')
    })

    it('should have sendMultiple method', () => {
      expect(typeof sgMail.sendMultiple).toBe('function')
    })
  })

  describe('ResponseError', () => {
    it('should create ResponseError with message and code', () => {
      const error = new ResponseError('Test error', 400)

      expect(error.message).toBe('Test error')
      expect(error.code).toBe(400)
      expect(error.name).toBe('ResponseError')
      expect(error.response.body.errors[0].message).toBe('Test error')
    })
  })
})

describe('Code size comparison', () => {
  it('should be under 150 LOC', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const code = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf-8')
    const lines = code.split('\n').filter((line) => {
      const trimmed = line.trim()
      // Count non-empty, non-comment lines
      return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')
    })

    console.log(`v2 implementation: ${lines.length} LOC`)
    expect(lines.length).toBeLessThan(150)
  })
})
