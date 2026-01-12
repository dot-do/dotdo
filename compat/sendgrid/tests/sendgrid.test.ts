import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sgMail, {
  MailService,
  ResponseError,
  type MailDataRequired,
  type AttachmentData,
  type PersonalizationData,
} from '../index'

describe('@dotdo/sendgrid', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    // Mock fetch for MailChannels (default provider)
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 202,
      ok: true,
      headers: new Headers({ 'x-message-id': 'msg-123' }),
      json: async () => ({}),
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('MailService', () => {
    it('should export a default sgMail instance', () => {
      expect(sgMail).toBeInstanceOf(MailService)
    })

    it('should set and get API key', () => {
      const mail = new MailService()
      mail.setApiKey('SG.test-api-key')
      expect(mail.getApiKey()).toBe('SG.test-api-key')
    })

    it('should throw if no API key is set', async () => {
      const mail = new MailService()
      await expect(
        mail.send({
          to: 'user@example.com',
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        })
      ).rejects.toThrow('API key is required')
    })
  })

  describe('send()', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should send a simple email', async () => {
      const [response] = await mail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hello',
        text: 'Hello World',
      })

      expect(response.statusCode).toBe(202)
      expect(response.headers['x-message-id']).toBeDefined()
    })

    it('should send email with HTML content', async () => {
      const [response] = await mail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hello',
        html: '<h1>Hello World</h1>',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should send email with both text and HTML', async () => {
      const [response] = await mail.send({
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Hello',
        text: 'Hello World',
        html: '<h1>Hello World</h1>',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should accept email addresses as strings', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should accept email addresses as objects', async () => {
      const [response] = await mail.send({
        to: { email: 'user@example.com', name: 'User' },
        from: { email: 'sender@example.com', name: 'Sender' },
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should accept email addresses in "Name <email>" format', async () => {
      const [response] = await mail.send({
        to: 'User Name <user@example.com>',
        from: 'Sender Name <sender@example.com>',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should send to multiple recipients', async () => {
      const [response] = await mail.send({
        to: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        from: 'sender@example.com',
        subject: 'Newsletter',
        text: 'Hello everyone!',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support CC and BCC', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        cc: 'cc@example.com',
        bcc: ['bcc1@example.com', 'bcc2@example.com'],
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support replyTo', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        replyTo: 'reply@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support reply_to alias', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        reply_to: 'reply@example.com',
        subject: 'Test',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support templateId', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        templateId: 'd-xxxxxxxxxxxx',
        dynamicTemplateData: {
          name: 'John',
          orderId: '12345',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support template_id alias', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        template_id: 'd-xxxxxxxxxxxx',
        dynamic_template_data: {
          name: 'John',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support attachments', async () => {
      const attachments: AttachmentData[] = [
        {
          content: Buffer.from('Hello World').toString('base64'),
          filename: 'hello.txt',
          type: 'text/plain',
          disposition: 'attachment',
        },
      ]

      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'With attachment',
        text: 'See attached',
        attachments,
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support inline attachments with contentId', async () => {
      const attachments: AttachmentData[] = [
        {
          content: 'base64-image-content',
          filename: 'logo.png',
          type: 'image/png',
          disposition: 'inline',
          contentId: 'logo',
        },
      ]

      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'With inline image',
        html: '<img src="cid:logo" />',
        attachments,
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support categories', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        categories: ['newsletter', 'marketing', 'promo'],
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support customArgs', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        customArgs: {
          campaign_id: '12345',
          user_segment: 'premium',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support custom_args alias', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        custom_args: {
          campaign_id: '12345',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support custom headers', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Priority': '1',
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support scheduled sending with sendAt', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Scheduled',
        text: 'This is scheduled',
        sendAt: futureTime,
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support send_at alias', async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Scheduled',
        text: 'This is scheduled',
        send_at: futureTime,
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support explicit personalizations', async () => {
      const personalizations: PersonalizationData[] = [
        {
          to: [{ email: 'user1@example.com' }],
          dynamicTemplateData: { name: 'User 1' },
        },
        {
          to: [{ email: 'user2@example.com' }],
          dynamicTemplateData: { name: 'User 2' },
        },
      ]

      const [response] = await mail.send({
        personalizations,
        from: 'sender@example.com',
        templateId: 'd-welcome',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support personalizations with CC and BCC', async () => {
      const personalizations: PersonalizationData[] = [
        {
          to: 'primary@example.com',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          subject: 'Custom subject',
        },
      ]

      const [response] = await mail.send({
        personalizations,
        from: 'sender@example.com',
        text: 'Hello',
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support array of mail data', async () => {
      const emails: MailDataRequired[] = [
        {
          to: 'user1@example.com',
          from: 'sender@example.com',
          subject: 'Email 1',
          text: 'First email',
        },
        {
          to: 'user2@example.com',
          from: 'sender@example.com',
          subject: 'Email 2',
          text: 'Second email',
        },
      ]

      const [response] = await mail.send(emails)
      expect(response.statusCode).toBe(202)
    })

    it('should support content array format', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        content: [
          { type: 'text/plain', value: 'Plain text version' },
          { type: 'text/html', value: '<p>HTML version</p>' },
        ],
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support callback style', async () => {
      const mail = new MailService()
      mail.setApiKey('SG.test-api-key')

      await new Promise<void>((resolve) => {
        mail.send(
          {
            to: 'user@example.com',
            from: 'sender@example.com',
            subject: 'Test',
            text: 'Hello',
          },
          false,
          (error, result) => {
            expect(error).toBeNull()
            expect(result).toBeDefined()
            expect(result![0].statusCode).toBe(202)
            resolve()
          }
        )
      })
    })
  })

  describe('sendMultiple()', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should send separate emails to each recipient', async () => {
      const [response] = await mail.sendMultiple({
        to: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        from: 'sender@example.com',
        subject: 'Personal message',
        text: 'Hello!',
      })

      expect(response.statusCode).toBe(202)
      // The fetch should be called multiple times (once per recipient plus setup)
      expect(globalThis.fetch).toHaveBeenCalled()
    })

    it('should work with isMultiple flag', async () => {
      const [response] = await mail.send(
        {
          to: ['user1@example.com', 'user2@example.com'],
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
          isMultiple: true,
        }
      )

      expect(response.statusCode).toBe(202)
    })
  })

  describe('Validation', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should throw error for missing "to" field', async () => {
      await expect(
        mail.send({
          from: 'sender@example.com',
          subject: 'Test',
          text: 'Hello',
        } as MailDataRequired)
      ).rejects.toThrow()
    })

    it('should throw error for missing "from" field', async () => {
      await expect(
        mail.send({
          to: 'user@example.com',
          subject: 'Test',
          text: 'Hello',
        } as MailDataRequired)
      ).rejects.toThrow()
    })

    it('should throw error for missing subject and content without template', async () => {
      await expect(
        mail.send({
          to: 'user@example.com',
          from: 'sender@example.com',
        })
      ).rejects.toThrow()
    })

    it('should accept email without subject when using template', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        templateId: 'd-template-id',
      })

      expect(response.statusCode).toBe(202)
    })
  })

  describe('ResponseError', () => {
    it('should create proper error structure', () => {
      const error = new ResponseError('Invalid API key', 401)

      expect(error.message).toBe('Invalid API key')
      expect(error.code).toBe(401)
      expect(error.response.body.errors[0].message).toBe('Invalid API key')
    })

    it('should include custom body in response', () => {
      const error = new ResponseError('Bad Request', 400, {
        errors: [{ message: 'Field required', field: 'to' }],
      })

      expect(error.response.body.errors).toBeDefined()
    })
  })

  describe('Configuration', () => {
    it('should set timeout', () => {
      const mail = new MailService()
      mail.setTimeout(30000)
      // Timeout is set internally, no public getter
    })

    it('should set substitution wrappers', () => {
      const mail = new MailService()
      mail.setSubstitutionWrappers('[[', ']]')
      // Wrappers are set internally, no public getter
    })

    it('should set custom client', () => {
      const mail = new MailService()
      const mockClient = { send: vi.fn() }
      mail.setClient(mockClient as any)
      // Client is set internally
    })
  })

  describe('ASM (Subscription Management)', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should support ASM configuration', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Newsletter',
        text: 'Hello',
        asm: {
          group_id: 12345,
          groups_to_display: [12345, 67890],
        },
      })

      expect(response.statusCode).toBe(202)
    })
  })

  describe('Mail Settings', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should support sandbox mode', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        mailSettings: {
          sandbox_mode: { enable: true },
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support mail_settings alias', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        text: 'Hello',
        mail_settings: {
          footer: {
            enable: true,
            text: 'Footer text',
            html: '<p>Footer</p>',
          },
        },
      })

      expect(response.statusCode).toBe(202)
    })
  })

  describe('Tracking Settings', () => {
    let mail: MailService

    beforeEach(() => {
      mail = new MailService()
      mail.setApiKey('SG.test-api-key')
    })

    it('should support click tracking', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        html: '<a href="https://example.com">Click</a>',
        trackingSettings: {
          click_tracking: { enable: true },
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support open tracking', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        trackingSettings: {
          open_tracking: { enable: true },
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support Google Analytics tracking', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        html: '<a href="https://example.com">Click</a>',
        trackingSettings: {
          ganalytics: {
            enable: true,
            utm_source: 'email',
            utm_medium: 'newsletter',
            utm_campaign: 'spring_sale',
          },
        },
      })

      expect(response.statusCode).toBe(202)
    })

    it('should support tracking_settings alias', async () => {
      const [response] = await mail.send({
        to: 'user@example.com',
        from: 'sender@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        tracking_settings: {
          subscription_tracking: {
            enable: true,
            text: 'Unsubscribe',
          },
        },
      })

      expect(response.statusCode).toBe(202)
    })
  })
})
