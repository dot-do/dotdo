// Twilio Integration Tests
// TDD tests for Twilio SMS integration (do-h3in)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TwilioIntegration,
  createTwilioIntegration,
  type TwilioConfig,
  type SendSmsRequest,
} from '../twilio'

describe('TwilioIntegration', () => {
  let twilio: TwilioIntegration

  beforeEach(() => {
    twilio = createTwilioIntegration()
  })

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(twilio.name).toBe('twilio')
      expect(twilio.version).toBe('1.0.0')
    })

    it('should have correct metadata', () => {
      expect(twilio.metadata.displayName).toBe('Twilio')
      expect(twilio.metadata.category).toBe('sms')
      expect(twilio.metadata.requiredConfig).toContain('accountSid')
      expect(twilio.metadata.requiredConfig).toContain('authToken')
    })

    it('should start uninitialized', () => {
      expect(twilio.status).toBe('uninitialized')
    })
  })

  describe('init', () => {
    it('should initialize with valid config', async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
        defaultFrom: '+15551234567',
      }

      await twilio.init(config)
      expect(twilio.status).toBe('ready')
    })

    it('should reject missing accountSid', async () => {
      const config = {
        authToken: 'test_auth_token_12345678901234',
      } as TwilioConfig

      await expect(twilio.init(config)).rejects.toThrow('Account SID is required')
    })

    it('should reject missing authToken', async () => {
      const config = {
        accountSid: 'AC' + 'x'.repeat(32),
      } as TwilioConfig

      await expect(twilio.init(config)).rejects.toThrow('Auth token is required')
    })

    it('should reject invalid accountSid format', async () => {
      const config: TwilioConfig = {
        accountSid: 'invalid_sid',
        authToken: 'test_auth_token_12345678901234',
      }

      await expect(twilio.init(config)).rejects.toThrow('Invalid Twilio Account SID format')
    })

    it('should set status to error on init failure', async () => {
      const config = { accountSid: 'invalid' } as TwilioConfig

      try {
        await twilio.init(config)
      } catch {
        // Expected
      }

      expect(twilio.status).toBe('error')
    })
  })

  describe('shutdown', () => {
    it('should reset to uninitialized state', async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }

      await twilio.init(config)
      expect(twilio.status).toBe('ready')

      await twilio.shutdown()
      expect(twilio.status).toBe('uninitialized')
    })
  })

  describe('healthCheck', () => {
    it('should return false when not initialized', async () => {
      const result = await twilio.healthCheck()
      expect(result).toBe(false)
    })

    it('should return true when initialized', async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }

      await twilio.init(config)
      const result = await twilio.healthCheck()
      expect(result).toBe(true)
    })
  })

  describe('methods.sendSms', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
        defaultFrom: '+15551234567',
      }
      await twilio.init(config)
    })

    it('should send SMS successfully', async () => {
      const request: SendSmsRequest = {
        to: '+15559876543',
        body: 'Hello from Twilio!',
      }

      const result = await twilio.methods.sendSms(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messageSid).toMatch(/^SM/)
        expect(result.data.status).toBe('queued')
        expect(result.data.to).toBe('+15559876543')
      }
    })

    it('should use default from number', async () => {
      const request: SendSmsRequest = {
        to: '+15559876543',
        body: 'Test message',
      }

      const result = await twilio.methods.sendSms(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.from).toBe('+15551234567')
      }
    })

    it('should use provided from number', async () => {
      const request: SendSmsRequest = {
        to: '+15559876543',
        from: '+15550001111',
        body: 'Test message',
      }

      const result = await twilio.methods.sendSms(request)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.from).toBe('+15550001111')
      }
    })

    it('should fail with missing to', async () => {
      const request = {
        body: 'Test message',
      } as SendSmsRequest

      const result = await twilio.methods.sendSms(request)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
      }
    })

    it('should fail with missing body', async () => {
      const request = {
        to: '+15559876543',
      } as SendSmsRequest

      const result = await twilio.methods.sendSms(request)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_REQUEST')
      }
    })

    it('should fail when not initialized', async () => {
      const uninitTwilio = createTwilioIntegration()
      const result = await uninitTwilio.methods.sendSms({
        to: '+15559876543',
        body: 'Test',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('NOT_INITIALIZED')
      }
    })
  })

  describe('methods.getMessage', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }
      await twilio.init(config)
    })

    it('should retrieve a message by SID', async () => {
      const result = await twilio.methods.getMessage('SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messageSid).toBe('SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
        expect(result.data.status).toBeDefined()
      }
    })
  })

  describe('methods.listMessages', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }
      await twilio.init(config)
    })

    it('should list messages', async () => {
      const result = await twilio.methods.listMessages({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true)
      }
    })

    it('should filter by to number', async () => {
      const result = await twilio.methods.listMessages({ to: '+15559876543' })
      expect(result.success).toBe(true)
    })

    it('should filter by from number', async () => {
      const result = await twilio.methods.listMessages({ from: '+15551234567' })
      expect(result.success).toBe(true)
    })
  })

  describe('methods.sendMms', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
        defaultFrom: '+15551234567',
      }
      await twilio.init(config)
    })

    it('should send MMS with media URL', async () => {
      const result = await twilio.methods.sendMms({
        to: '+15559876543',
        body: 'Check out this image!',
        mediaUrl: ['https://example.com/image.jpg'],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messageSid).toMatch(/^MM/)
      }
    })
  })

  describe('methods.lookupPhoneNumber', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }
      await twilio.init(config)
    })

    it('should lookup phone number info', async () => {
      const result = await twilio.methods.lookupPhoneNumber('+15551234567')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.phoneNumber).toBe('+15551234567')
        expect(result.data.countryCode).toBeDefined()
      }
    })
  })

  describe('webhook handling', () => {
    beforeEach(async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }
      await twilio.init(config)
    })

    it('should handle incoming webhook', async () => {
      const webhookBody = new URLSearchParams({
        MessageSid: 'SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        From: '+15559876543',
        To: '+15551234567',
        Body: 'Hello!',
      }).toString()

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: webhookBody,
      })

      const response = await twilio.handleWebhook!(request)
      expect(response.status).toBe(200)
    })

    it('should return 503 when not initialized', async () => {
      const uninitTwilio = createTwilioIntegration()
      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        body: 'test',
      })

      const response = await uninitTwilio.handleWebhook!(request)
      expect(response.status).toBe(503)
    })
  })

  describe('event handlers', () => {
    it('should register and call event handlers', async () => {
      const config: TwilioConfig = {
        accountSid: 'AC' + 'x'.repeat(32),
        authToken: 'test_auth_token_12345678901234',
      }
      await twilio.init(config)

      const events: unknown[] = []
      twilio.onEvent!((event) => {
        events.push(event)
      })

      // Simulate webhook
      const webhookBody = new URLSearchParams({
        MessageSid: 'SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        MessageStatus: 'delivered',
      }).toString()

      const request = new Request('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: webhookBody,
      })

      await twilio.handleWebhook!(request)
      expect(events.length).toBeGreaterThan(0)
    })
  })
})

describe('createTwilioIntegration', () => {
  it('should create a new TwilioIntegration instance', () => {
    const twilio = createTwilioIntegration()
    expect(twilio).toBeInstanceOf(TwilioIntegration)
    expect(twilio.name).toBe('twilio')
  })
})
