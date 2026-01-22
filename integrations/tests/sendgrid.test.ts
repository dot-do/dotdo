// SendGrid Integration Tests
// TDD tests for SendGrid email integration (do-wmao)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SendGridIntegration,
  createSendGridIntegration,
  type SendGridConfig,
  type SendEmailRequest,
  type EmailRecipient,
  type SendGridContact,
} from '../sendgrid'

describe('SendGridIntegration', () => {
  let sendgrid: SendGridIntegration

  beforeEach(() => {
    sendgrid = createSendGridIntegration()
  })

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(sendgrid.name).toBe('sendgrid')
      expect(sendgrid.version).toBe('1.0.0')
    })

    it('should have correct metadata', () => {
      expect(sendgrid.metadata.displayName).toBe('SendGrid')
      expect(sendgrid.metadata.category).toBe('email')
      expect(sendgrid.metadata.requiredConfig).toContain('apiKey')
      expect(sendgrid.metadata.docsUrl).toBe('https://docs.sendgrid.com')
    })

    it('should start uninitialized', () => {
      expect(sendgrid.status).toBe('uninitialized')
    })
  })

  describe('init', () => {
    it('should initialize with valid config', async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key_1234567890',
        defaultFrom: 'noreply@example.com',
      }

      await sendgrid.init(config)
      expect(sendgrid.status).toBe('ready')
    })

    it('should reject missing apiKey', async () => {
      const config = {} as SendGridConfig

      await expect(sendgrid.init(config)).rejects.toThrow('SendGrid API key is required')
    })

    it('should reject invalid apiKey format', async () => {
      const config: SendGridConfig = {
        apiKey: 'invalid_key_without_SG_prefix',
      }

      await expect(sendgrid.init(config)).rejects.toThrow('Invalid SendGrid API key format')
    })

    it('should accept valid SG. prefixed keys', async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.abcdefg123456',
      }

      await sendgrid.init(config)
      expect(sendgrid.status).toBe('ready')
    })

    it('should set status to error on init failure', async () => {
      const config = { apiKey: 'invalid' } as SendGridConfig

      try {
        await sendgrid.init(config)
      } catch {
        // Expected
      }

      expect(sendgrid.status).toBe('error')
    })
  })

  describe('shutdown', () => {
    it('should reset to uninitialized state', async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }

      await sendgrid.init(config)
      expect(sendgrid.status).toBe('ready')

      await sendgrid.shutdown()
      expect(sendgrid.status).toBe('uninitialized')
    })
  })

  describe('healthCheck', () => {
    it('should return false when not initialized', async () => {
      const result = await sendgrid.healthCheck()
      expect(result).toBe(false)
    })

    it('should return true when initialized', async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }

      await sendgrid.init(config)
      const result = await sendgrid.healthCheck()
      expect(result).toBe(true)
    })
  })

  describe('methods.sendEmail', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
        defaultFrom: 'noreply@example.com',
      }
      await sendgrid.init(config)
    })

    it('should send email successfully', async () => {
      const request: SendEmailRequest = {
        to: { email: 'recipient@example.com', name: 'Test User' },
        subject: 'Test Email',
        text: 'This is a test email',
      }

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messageId).toMatch(/^msg_/)
        expect(result.data.accepted).toContain('recipient@example.com')
        expect(result.data.rejected).toEqual([])
      }
    })

    it('should send email to multiple recipients', async () => {
      const recipients: EmailRecipient[] = [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' },
      ]

      const request: SendEmailRequest = {
        to: recipients,
        subject: 'Test Email',
        html: '<p>This is a test</p>',
      }

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.accepted).toHaveLength(2)
        expect(result.data.accepted).toContain('user1@example.com')
        expect(result.data.accepted).toContain('user2@example.com')
      }
    })

    it('should fail with missing recipient', async () => {
      const request = {
        subject: 'Test',
        text: 'Test content',
      } as SendEmailRequest

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toContain('to')
      }
    })

    it('should fail with missing subject', async () => {
      const request = {
        to: { email: 'test@example.com' },
        text: 'Test content',
      } as SendEmailRequest

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toContain('Subject')
      }
    })

    it('should fail with missing content (no text, html, or templateId)', async () => {
      const request = {
        to: { email: 'test@example.com' },
        subject: 'Test',
      } as SendEmailRequest

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toContain('content')
      }
    })

    it('should accept templateId as content', async () => {
      const request: SendEmailRequest = {
        to: { email: 'test@example.com' },
        subject: 'Test',
        templateId: 'd-template123',
      }

      const result = await sendgrid.methods.sendEmail(request)

      expect(result.success).toBe(true)
    })

    it('should fail when not initialized', async () => {
      const uninitSendgrid = createSendGridIntegration()
      const result = await uninitSendgrid.methods.sendEmail({
        to: { email: 'test@example.com' },
        subject: 'Test',
        text: 'Content',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('methods.sendTemplateEmail', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
        defaultFrom: 'noreply@example.com',
      }
      await sendgrid.init(config)
    })

    it('should send template email successfully', async () => {
      const result = await sendgrid.methods.sendTemplateEmail(
        'd-template123',
        { email: 'recipient@example.com' },
        { name: 'John', orderId: '12345' }
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messageId).toMatch(/^msg_/)
        expect(result.data.accepted).toContain('recipient@example.com')
      }
    })

    it('should send template email to multiple recipients', async () => {
      const recipients: EmailRecipient[] = [
        { email: 'user1@example.com' },
        { email: 'user2@example.com' },
      ]

      const result = await sendgrid.methods.sendTemplateEmail(
        'd-template123',
        recipients,
        { greeting: 'Hello!' }
      )

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.accepted).toHaveLength(2)
      }
    })

    it('should fail with missing templateId', async () => {
      const result = await sendgrid.methods.sendTemplateEmail(
        '',
        { email: 'test@example.com' },
        {}
      )

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toContain('Template ID')
      }
    })
  })

  describe('methods.addContact', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }
      await sendgrid.init(config)
    })

    it('should add a contact successfully', async () => {
      const contact: SendGridContact = {
        email: 'newcontact@example.com',
        firstName: 'John',
        lastName: 'Doe',
      }

      const result = await sendgrid.methods.addContact(contact)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toMatch(/^con_/)
        expect(result.data.email).toBe('newcontact@example.com')
        expect(result.data.firstName).toBe('John')
        expect(result.data.lastName).toBe('Doe')
      }
    })

    it('should add contact with custom fields', async () => {
      const contact: SendGridContact = {
        email: 'contact@example.com',
        customFields: { company: 'Acme Inc', tier: 1 },
      }

      const result = await sendgrid.methods.addContact(contact)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.customFields).toEqual({ company: 'Acme Inc', tier: 1 })
      }
    })

    it('should fail with missing email', async () => {
      const contact = {
        firstName: 'John',
      } as SendGridContact

      const result = await sendgrid.methods.addContact(contact)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
        expect(result.error.message).toContain('email')
      }
    })
  })

  describe('methods.getContact', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }
      await sendgrid.init(config)
    })

    it('should retrieve a contact by email', async () => {
      const result = await sendgrid.methods.getContact('test@example.com')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).not.toBeNull()
        expect(result.data!.email).toBe('test@example.com')
        expect(result.data!.id).toMatch(/^con_/)
      }
    })
  })

  describe('methods.deleteContact', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }
      await sendgrid.init(config)
    })

    it('should delete a contact', async () => {
      const result = await sendgrid.methods.deleteContact('test@example.com')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(true)
      }
    })
  })

  describe('methods.getStats', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }
      await sendgrid.init(config)
    })

    it('should retrieve email statistics', async () => {
      const startDate = new Date('2024-01-01')
      const endDate = new Date('2024-01-31')

      const result = await sendgrid.methods.getStats(startDate, endDate)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.delivered).toBeGreaterThanOrEqual(0)
        expect(result.data.opened).toBeGreaterThanOrEqual(0)
        expect(result.data.clicked).toBeGreaterThanOrEqual(0)
        expect(result.data.bounced).toBeGreaterThanOrEqual(0)
        expect(result.data.unsubscribed).toBeGreaterThanOrEqual(0)
        expect(result.data.spamReported).toBeGreaterThanOrEqual(0)
      }
    })

    it('should work with only start date', async () => {
      const startDate = new Date('2024-01-01')

      const result = await sendgrid.methods.getStats(startDate)

      expect(result.success).toBe(true)
    })
  })

  describe('webhook handling', () => {
    beforeEach(async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
        webhookSigningKey: 'test_signing_key',
      }
      await sendgrid.init(config)
    })

    it('should handle incoming webhook events', async () => {
      const events = [
        {
          event: 'delivered',
          email: 'test@example.com',
          timestamp: Math.floor(Date.now() / 1000),
          sg_message_id: 'msg_123',
        },
      ]

      // Without signature verification for test purposes
      const sendgridNoKey = createSendGridIntegration()
      await sendgridNoKey.init({ apiKey: 'SG.test_api_key' })

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      })

      const response = await sendgridNoKey.handleWebhook!(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.received).toBe(true)
    })

    it('should handle multiple events in single webhook', async () => {
      const events = [
        { event: 'delivered', email: 'user1@example.com', timestamp: Date.now() / 1000, sg_message_id: 'msg_1' },
        { event: 'opened', email: 'user2@example.com', timestamp: Date.now() / 1000, sg_message_id: 'msg_2' },
        { event: 'clicked', email: 'user3@example.com', timestamp: Date.now() / 1000, sg_message_id: 'msg_3' },
      ]

      const sendgridNoKey = createSendGridIntegration()
      await sendgridNoKey.init({ apiKey: 'SG.test_api_key' })

      const receivedEvents: unknown[] = []
      sendgridNoKey.onEvent!((event) => receivedEvents.push(event))

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      })

      await sendgridNoKey.handleWebhook!(request)
      expect(receivedEvents).toHaveLength(3)
    })

    it('should return 503 when not initialized', async () => {
      const uninitSendgrid = createSendGridIntegration()
      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: '[]',
      })

      const response = await uninitSendgrid.handleWebhook!(request)
      expect(response.status).toBe(503)
    })

    it('should return 400 for missing signature headers when key is configured', async () => {
      const events = [{ event: 'delivered', email: 'test@example.com', timestamp: Date.now() / 1000 }]

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      })

      const response = await sendgrid.handleWebhook!(request)
      expect(response.status).toBe(400)

      const body = await response.json()
      expect(body.error).toContain('Missing')
    })
  })

  describe('event handlers', () => {
    it('should register and call event handlers', async () => {
      const config: SendGridConfig = {
        apiKey: 'SG.test_api_key',
      }
      await sendgrid.init(config)

      const events: unknown[] = []
      sendgrid.onEvent!((event) => {
        events.push(event)
      })

      const webhookEvents = [
        {
          event: 'bounce',
          email: 'bounced@example.com',
          timestamp: Math.floor(Date.now() / 1000),
          sg_message_id: 'msg_bounce',
          reason: 'Invalid address',
        },
      ]

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookEvents),
      })

      await sendgrid.handleWebhook!(request)

      expect(events).toHaveLength(1)
      expect((events[0] as any).type).toBe('bounce')
      expect((events[0] as any).integration).toBe('sendgrid')
      expect((events[0] as any).payload.email).toBe('bounced@example.com')
    })
  })
})

describe('createSendGridIntegration', () => {
  it('should create a new SendGridIntegration instance', () => {
    const sendgrid = createSendGridIntegration()
    expect(sendgrid).toBeInstanceOf(SendGridIntegration)
    expect(sendgrid.name).toBe('sendgrid')
  })
})

describe('SendGridIntegration error handling', () => {
  let sendgrid: SendGridIntegration

  beforeEach(() => {
    sendgrid = createSendGridIntegration()
  })

  describe('all methods fail when not initialized', () => {
    it('sendTemplateEmail should fail when not initialized', async () => {
      const result = await sendgrid.methods.sendTemplateEmail(
        'd-template123',
        { email: 'test@example.com' },
        {}
      )
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
        expect(result.error.message).toContain('not initialized')
      }
    })

    it('addContact should fail when not initialized', async () => {
      const result = await sendgrid.methods.addContact({ email: 'test@example.com' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('getContact should fail when not initialized', async () => {
      const result = await sendgrid.methods.getContact('test@example.com')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('deleteContact should fail when not initialized', async () => {
      const result = await sendgrid.methods.deleteContact('test@example.com')
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })

    it('getStats should fail when not initialized', async () => {
      const result = await sendgrid.methods.getStats(new Date())
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('sendEmail validation', () => {
    beforeEach(async () => {
      await sendgrid.init({ apiKey: 'SG.test_api_key' })
    })

    it('should accept html content instead of text', async () => {
      const result = await sendgrid.methods.sendEmail({
        to: { email: 'test@example.com' },
        subject: 'Test',
        html: '<h1>Hello</h1>',
      })

      expect(result.success).toBe(true)
    })

    it('should include requestId in successful responses', async () => {
      const result = await sendgrid.methods.sendEmail({
        to: { email: 'test@example.com' },
        subject: 'Test',
        text: 'Hello',
      })

      expect(result.success).toBe(true)
      expect(result.requestId).toMatch(/^req_/)
    })
  })

  describe('webhook error cases', () => {
    it('should return 400 for invalid JSON in webhook body', async () => {
      await sendgrid.init({ apiKey: 'SG.test_api_key' })

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {{{',
      })

      const response = await sendgrid.handleWebhook!(request)
      expect(response.status).toBe(400)
    })

    it('should return 401 for invalid signature when key is configured', async () => {
      await sendgrid.init({
        apiKey: 'SG.test_api_key',
        webhookSigningKey: 'test_signing_key',
      })

      const events = [{ event: 'delivered', email: 'test@example.com', timestamp: Date.now() / 1000 }]

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Twilio-Email-Event-Webhook-Signature': 'invalidsignature',
          'X-Twilio-Email-Event-Webhook-Timestamp': String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify(events),
      })

      const response = await sendgrid.handleWebhook!(request)
      expect(response.status).toBe(401)

      const body = await response.json()
      expect(body.error).toBe('Signature verification failed')
    })
  })

  describe('lifecycle edge cases', () => {
    it('should handle multiple init calls', async () => {
      await sendgrid.init({ apiKey: 'SG.first_key' })
      expect(sendgrid.status).toBe('ready')

      await sendgrid.init({ apiKey: 'SG.second_key' })
      expect(sendgrid.status).toBe('ready')
    })

    it('should handle shutdown when not initialized', async () => {
      await sendgrid.shutdown()
      expect(sendgrid.status).toBe('uninitialized')
    })

    it('should clear webhook handlers on shutdown', async () => {
      await sendgrid.init({ apiKey: 'SG.test_api_key' })

      const events: unknown[] = []
      sendgrid.onEvent!((event) => events.push(event))

      await sendgrid.shutdown()

      await sendgrid.init({ apiKey: 'SG.test_api_key' })

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ event: 'test', email: 'test@example.com', timestamp: Date.now() / 1000, sg_message_id: 'msg_1' }]),
      })

      await sendgrid.handleWebhook!(request)
      expect(events.length).toBe(0)
    })
  })

  describe('metadata validation', () => {
    it('should have optional config fields defined', () => {
      expect(sendgrid.metadata.optionalConfig).toContain('defaultFrom')
      expect(sendgrid.metadata.optionalConfig).toContain('defaultFromName')
      expect(sendgrid.metadata.optionalConfig).toContain('webhookSigningKey')
    })

    it('should have website URL defined', () => {
      expect(sendgrid.metadata.websiteUrl).toBe('https://sendgrid.com')
    })
  })
})
