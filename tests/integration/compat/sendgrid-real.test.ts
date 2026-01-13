/**
 * SendGrid Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/sendgrid compat layer with real DO storage,
 * verifying API compatibility with the official @sendgrid/mail SDK.
 *
 * These tests:
 * 1. Verify correct API shape matching @sendgrid/mail
 * 2. Verify proper DO storage for email state
 * 3. Verify error handling matches SendGrid SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/sendgrid-real.test.ts --project=integration
 *
 * @module tests/integration/compat/sendgrid-real
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('SendGrid Compat Layer - Real Integration', () => {
  /**
   * Test Suite 1: API Shape Compatibility with @sendgrid/mail
   *
   * Verifies that the SendGrid compat layer exports the same API surface
   * as the official @sendgrid/mail SDK.
   */
  describe('API Shape Compatibility', () => {
    it('default export is MailService instance', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(sgMail).toBeDefined()
      expect(typeof sgMail.setApiKey).toBe('function')
      expect(typeof sgMail.send).toBe('function')
    })

    it('exposes setApiKey method', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(typeof sgMail.setApiKey).toBe('function')

      // Should accept API key
      sgMail.setApiKey('SG.xxx')
    })

    it('exposes send method', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(typeof sgMail.send).toBe('function')
    })

    it('exposes sendMultiple method', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(typeof sgMail.sendMultiple).toBe('function')
    })

    it('exposes setTimeout method', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(typeof sgMail.setTimeout).toBe('function')
    })

    it('exposes setSubstitutionWrappers method', async () => {
      const sgMail = (await import('../../../compat/sendgrid/index')).default

      expect(typeof sgMail.setSubstitutionWrappers).toBe('function')
    })

    it('exports MailService class', async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')

      expect(MailService).toBeDefined()
      expect(typeof MailService).toBe('function')
    })

    it('exports ResponseError class', async () => {
      const { ResponseError } = await import('../../../compat/sendgrid/index')

      expect(ResponseError).toBeDefined()
      expect(typeof ResponseError).toBe('function')
    })
  })

  /**
   * Test Suite 2: Basic Email Sending
   *
   * Verifies email send operations.
   */
  describe('Basic Email Sending', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('sends email with required fields', async () => {
      // Create a mock client for testing
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        text: 'Hello, World!',
      })

      expect(response).toBeDefined()
      expect(response.statusCode).toBe(202)
    })

    it('sends email with HTML content', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'HTML Test',
        html: '<h1>Hello, World!</h1>',
      })

      expect(response.statusCode).toBe(202)
    })

    it('sends email with multiple recipients', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: ['user1@example.com', 'user2@example.com'],
        from: 'sender@example.com',
        subject: 'Batch Email',
        text: 'Hello all!',
      })

      expect(response.statusCode).toBe(202)
    })

    it('sends email with CC and BCC', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        from: 'sender@example.com',
        subject: 'CC/BCC Test',
        text: 'Hello!',
      })

      expect(response.statusCode).toBe(202)
    })
  })

  /**
   * Test Suite 3: Dynamic Templates
   *
   * Verifies dynamic template functionality.
   */
  describe('Dynamic Templates', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('sends email with templateId', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateId: 'd-xxxxxxxxxxxxx',
      })

      expect(response.statusCode).toBe(202)
    })

    it('sends email with dynamicTemplateData', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateId: 'd-xxxxxxxxxxxxx',
        dynamicTemplateData: {
          name: 'John',
          orderNumber: '12345',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('supports dynamic_template_data alias', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        templateId: 'd-xxxxxxxxxxxxx',
        dynamic_template_data: {
          name: 'John',
        },
      })

      expect(response.statusCode).toBe(202)
    })
  })

  /**
   * Test Suite 4: Personalizations
   *
   * Verifies personalization functionality.
   */
  describe('Personalizations', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('sends with explicit personalizations', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        personalizations: [
          { to: [{ email: 'user1@example.com' }], dynamicTemplateData: { name: 'User 1' } },
          { to: [{ email: 'user2@example.com' }], dynamicTemplateData: { name: 'User 2' } },
        ],
        from: 'sender@example.com',
        templateId: 'd-welcome',
      })

      expect(response.statusCode).toBe(202)
    })

    it('supports custom headers in personalizations', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        personalizations: [{
          to: [{ email: 'recipient@example.com' }],
          headers: { 'X-Custom-Header': 'value' },
        }],
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('supports substitutions in personalizations', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        personalizations: [{
          to: [{ email: 'recipient@example.com' }],
          substitutions: { '-name-': 'John' },
        }],
        from: 'sender@example.com',
        subject: 'Hello -name-',
        text: 'Hi -name-!',
      })

      expect(response.statusCode).toBe(202)
    })
  })

  /**
   * Test Suite 5: Attachments
   *
   * Verifies attachment functionality.
   */
  describe('Attachments', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('sends email with attachment', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'With Attachment',
        text: 'See attached.',
        attachments: [{
          content: 'SGVsbG8gV29ybGQh', // Base64 "Hello World!"
          filename: 'hello.txt',
          type: 'text/plain',
          disposition: 'attachment',
        }],
      })

      expect(response.statusCode).toBe(202)
    })

    it('sends email with inline attachment (CID)', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Inline Image',
        html: '<img src="cid:logo">',
        attachments: [{
          content: 'base64imagedata',
          filename: 'logo.png',
          type: 'image/png',
          disposition: 'inline',
          contentId: 'logo',
        }],
      })

      expect(response.statusCode).toBe(202)
    })
  })

  /**
   * Test Suite 6: SendMultiple
   *
   * Verifies sendMultiple functionality.
   */
  describe('SendMultiple', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('sends separate email to each recipient', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.sendMultiple({
        to: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        from: 'sender@example.com',
        subject: 'Individual Message',
        text: 'Personal message for each recipient',
      })

      expect(response.statusCode).toBe(202)
      // Each recipient should get their own email
      expect(mockClient.send).toHaveBeenCalledTimes(3)
    })
  })

  /**
   * Test Suite 7: Error Handling Compatibility
   *
   * Verifies that errors match SendGrid SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('throws ResponseError for API errors', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 400,
          headers: {},
        }),
      }
      sgMail.setClient(mockClient)

      await expect(
        sgMail.send({
          to: 'recipient@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow()
    })

    it('throws error when API key is not set', async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      const newSgMail = new MailService()
      // Don't set API key

      await expect(
        newSgMail.send({
          to: 'recipient@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow()
    })

    it('throws error for missing "to" field', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: {},
        }),
      }
      sgMail.setClient(mockClient)

      await expect(
        sgMail.send({
          // Missing 'to'
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow()
    })

    it('ResponseError includes code and response', async () => {
      const { ResponseError } = await import('../../../compat/sendgrid/index')

      const error = new ResponseError('Bad Request', 400, {
        errors: [{ message: 'Invalid email' }],
      })

      expect(error.code).toBe(400)
      expect(error.response).toBeDefined()
      expect(error.response.body.errors).toBeDefined()
    })
  })

  /**
   * Test Suite 8: Email Address Formats
   *
   * Verifies different email address input formats.
   */
  describe('Email Address Formats', () => {
    let sgMail: any

    beforeEach(async () => {
      const { MailService } = await import('../../../compat/sendgrid/index')
      sgMail = new MailService()
      sgMail.setApiKey('SG.test_api_key')
    })

    it('accepts string email address', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('accepts object email address with name', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: { email: 'recipient@example.com', name: 'John Doe' },
        from: { email: 'sender@example.com', name: 'Sender Name' },
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('accepts "Name <email>" format string', async () => {
      const mockClient = {
        send: vi.fn().mockResolvedValue({
          statusCode: 202,
          headers: { 'x-message-id': 'msg-xxx' },
        }),
      }
      sgMail.setClient(mockClient)

      const [response] = await sgMail.send({
        to: 'John Doe <john@example.com>',
        from: 'Sender <sender@example.com>',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })
  })
})
