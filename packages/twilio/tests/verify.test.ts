/**
 * @dotdo/twilio/verify - Twilio Verify OTP API Compatibility Tests
 *
 * TDD RED phase: Tests for Twilio Verify OTP service.
 *
 * Test coverage:
 * 1. Start verification (SMS, call, email, WhatsApp)
 * 2. Check verification code
 * 3. Verification expiration
 * 4. Rate limiting
 * 5. Invalid codes
 * 6. Channel-specific behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  TwilioVerify,
  TwilioVerifyError,
  createVerifyClient,
  type Verification,
  type VerificationCheck,
  type VerifyChannel,
  type VerifyStatus,
  type StartVerificationParams,
  type CheckVerificationParams,
} from '../src/verify'

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockFetch = vi.fn()

// Helper to create mock verification response
function createMockVerification(overrides?: Partial<Verification>): Verification {
  const now = new Date().toISOString()
  return {
    sid: 'VE' + 'a'.repeat(32),
    service_sid: 'VA' + 'b'.repeat(32),
    account_sid: 'AC' + 'c'.repeat(32),
    to: '+15558675310',
    channel: 'sms',
    status: 'pending',
    valid: false,
    lookup: {},
    amount: null,
    payee: null,
    send_code_attempts: [
      {
        time: now,
        channel: 'sms',
        attempt_sid: 'AT' + 'd'.repeat(32),
      },
    ],
    date_created: now,
    date_updated: now,
    sna: null,
    url: `https://verify.twilio.com/v2/Services/VA${'b'.repeat(32)}/Verifications/VE${'a'.repeat(32)}`,
    ...overrides,
  }
}

// Helper to create mock verification check response
function createMockVerificationCheck(
  overrides?: Partial<VerificationCheck>
): VerificationCheck {
  const now = new Date().toISOString()
  return {
    sid: 'VE' + 'a'.repeat(32),
    service_sid: 'VA' + 'b'.repeat(32),
    account_sid: 'AC' + 'c'.repeat(32),
    to: '+15558675310',
    channel: 'sms',
    status: 'approved',
    valid: true,
    amount: null,
    payee: null,
    date_created: now,
    date_updated: now,
    ...overrides,
  }
}

// Helper to create mock API response
function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper to create mock error response
function createMockErrorResponse(
  code: number,
  message: string,
  status = 400
): Response {
  return createMockResponse(
    {
      code,
      message,
      more_info: `https://www.twilio.com/docs/errors/${code}`,
      status,
    },
    status
  )
}

describe('Twilio Verify OTP', () => {
  const TEST_ACCOUNT_SID = 'AC' + 'test'.repeat(8)
  const TEST_AUTH_TOKEN = 'auth_token_' + 'test'.repeat(4)
  const TEST_SERVICE_SID = 'VA' + 'service'.repeat(4) + 'test'

  let verify: TwilioVerify

  beforeEach(() => {
    vi.clearAllMocks()
    verify = new TwilioVerify({
      accountSid: TEST_ACCOUNT_SID,
      authToken: TEST_AUTH_TOKEN,
      serviceSid: TEST_SERVICE_SID,
      fetch: mockFetch,
      autoRetry: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // CLIENT CREATION
  // ============================================================================

  describe('TwilioVerify client', () => {
    it('should create a client with required credentials', () => {
      const client = new TwilioVerify({
        accountSid: 'AC123',
        authToken: 'token123',
        serviceSid: 'VA123',
      })
      expect(client).toBeDefined()
    })

    it('should throw error when accountSid is missing', () => {
      expect(
        () =>
          new TwilioVerify({
            accountSid: '',
            authToken: 'token123',
            serviceSid: 'VA123',
          })
      ).toThrow('accountSid is required')
    })

    it('should throw error when authToken is missing', () => {
      expect(
        () =>
          new TwilioVerify({
            accountSid: 'AC123',
            authToken: '',
            serviceSid: 'VA123',
          })
      ).toThrow('authToken is required')
    })

    it('should throw error when serviceSid is missing', () => {
      expect(
        () =>
          new TwilioVerify({
            accountSid: 'AC123',
            authToken: 'token123',
            serviceSid: '',
          })
      ).toThrow('serviceSid is required')
    })

    it('should create client with factory function', () => {
      const client = createVerifyClient({
        accountSid: 'AC123',
        authToken: 'token123',
        serviceSid: 'VA123',
      })
      expect(client).toBeInstanceOf(TwilioVerify)
    })

    it('should accept custom configuration options', () => {
      const client = new TwilioVerify({
        accountSid: 'AC123',
        authToken: 'token123',
        serviceSid: 'VA123',
        host: 'verify.custom.com',
        timeout: 60000,
        autoRetry: false,
        maxRetries: 5,
      })
      expect(client).toBeDefined()
    })
  })

  // ============================================================================
  // START VERIFICATION - SMS CHANNEL
  // ============================================================================

  describe('startVerification - SMS channel', () => {
    it('should start SMS verification with phone number', async () => {
      const mockVerification = createMockVerification({
        to: '+15558675310',
        channel: 'sms',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(result.sid).toMatch(/^VE[a-f0-9]{32}$/i)
      expect(result.to).toBe('+15558675310')
      expect(result.channel).toBe('sms')
      expect(result.status).toBe('pending')
      expect(result.valid).toBe(false)
    })

    it('should include send_code_attempts in response', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(result.send_code_attempts).toBeDefined()
      expect(result.send_code_attempts.length).toBeGreaterThan(0)
      expect(result.send_code_attempts[0].channel).toBe('sms')
    })

    it('should support custom code length (4-10 digits)', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        codeLength: 8,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('CodeLength=8'),
        })
      )
    })

    it('should reject code length less than 4', async () => {
      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
          codeLength: 3 as 4,
        })
      ).rejects.toThrow()
    })

    it('should reject code length greater than 10', async () => {
      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
          codeLength: 11 as 10,
        })
      ).rejects.toThrow()
    })

    it('should support locale parameter', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        locale: 'es',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Locale=es'),
        })
      )
    })

    it('should support custom friendly name', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        customFriendlyName: 'MyApp',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('CustomFriendlyName=MyApp'),
        })
      )
    })

    it('should support custom message template', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        customMessage: 'Your code is {code}. Do not share it.',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('CustomMessage='),
        })
      )
    })

    it('should support Android app hash for SMS Retriever API', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        appHash: 'abc123xyz',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('AppHash=abc123xyz'),
        })
      )
    })

    it('should reject invalid phone number format', async () => {
      await expect(
        verify.startVerification({
          to: '5558675310', // Missing + prefix
          channel: 'sms',
        })
      ).rejects.toThrow()
    })

    it('should reject missing to parameter', async () => {
      await expect(
        verify.startVerification({
          to: '',
          channel: 'sms',
        })
      ).rejects.toThrow()
    })

    it('should reject missing channel parameter', async () => {
      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: '' as VerifyChannel,
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // START VERIFICATION - CALL CHANNEL
  // ============================================================================

  describe('startVerification - Call channel', () => {
    it('should start voice call verification', async () => {
      const mockVerification = createMockVerification({
        to: '+15558675310',
        channel: 'call',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'call',
      })

      expect(result.channel).toBe('call')
      expect(result.status).toBe('pending')
    })

    it('should support DTMF send_digits parameter', async () => {
      const mockVerification = createMockVerification({ channel: 'call' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'call',
        sendDigits: 'wwww1928',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('SendDigits='),
        })
      )
    })

    it('should support locale for call language', async () => {
      const mockVerification = createMockVerification({ channel: 'call' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'call',
        locale: 'fr',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Locale=fr'),
        })
      )
    })
  })

  // ============================================================================
  // START VERIFICATION - EMAIL CHANNEL
  // ============================================================================

  describe('startVerification - Email channel', () => {
    it('should start email verification', async () => {
      const mockVerification = createMockVerification({
        to: 'user@example.com',
        channel: 'email',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: 'user@example.com',
        channel: 'email',
      })

      expect(result.to).toBe('user@example.com')
      expect(result.channel).toBe('email')
      expect(result.status).toBe('pending')
    })

    it('should support email channel configuration', async () => {
      const mockVerification = createMockVerification({ channel: 'email' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: 'user@example.com',
        channel: 'email',
        channelConfiguration: {
          email: {
            from: 'noreply@myapp.com',
            from_name: 'My App',
            substitutions: {
              company_name: 'Acme Corp',
            },
          },
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ChannelConfiguration='),
        })
      )
    })

    it('should reject phone number for email channel', async () => {
      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'email',
        })
      ).rejects.toThrow()
    })

    it('should reject invalid email format', async () => {
      await expect(
        verify.startVerification({
          to: 'not-an-email',
          channel: 'email',
        })
      ).rejects.toThrow()
    })

    it('should support custom template SID', async () => {
      const mockVerification = createMockVerification({ channel: 'email' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: 'user@example.com',
        channel: 'email',
        templateSid: 'HJ123456789',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('TemplateSid=HJ123456789'),
        })
      )
    })
  })

  // ============================================================================
  // START VERIFICATION - WHATSAPP CHANNEL
  // ============================================================================

  describe('startVerification - WhatsApp channel', () => {
    it('should start WhatsApp verification', async () => {
      const mockVerification = createMockVerification({
        to: '+15558675310',
        channel: 'whatsapp',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'whatsapp',
      })

      expect(result.channel).toBe('whatsapp')
      expect(result.status).toBe('pending')
    })

    it('should support WhatsApp channel configuration', async () => {
      const mockVerification = createMockVerification({ channel: 'whatsapp' })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'whatsapp',
        channelConfiguration: {
          whatsapp: {
            from: '+14155551234',
            message_service_sid: 'MG123456789',
          },
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('ChannelConfiguration='),
        })
      )
    })

    it('should require E.164 format for WhatsApp', async () => {
      await expect(
        verify.startVerification({
          to: 'whatsapp:+15558675310', // Wrong format
          channel: 'whatsapp',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // START VERIFICATION - SCA/PSD2 SUPPORT
  // ============================================================================

  describe('startVerification - SCA/PSD2', () => {
    it('should support amount and payee for PSD2 compliance', async () => {
      const mockVerification = createMockVerification({
        amount: '99.99',
        payee: 'Acme Corp',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        amount: '99.99',
        payee: 'Acme Corp',
      })

      expect(result.amount).toBe('99.99')
      expect(result.payee).toBe('Acme Corp')
    })
  })

  // ============================================================================
  // CHECK VERIFICATION
  // ============================================================================

  describe('checkVerification', () => {
    it('should verify correct code and return approved status', async () => {
      const mockCheck = createMockVerificationCheck({
        status: 'approved',
        valid: true,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck))

      const result = await verify.checkVerification({
        to: '+15558675310',
        code: '123456',
      })

      expect(result.valid).toBe(true)
      expect(result.status).toBe('approved')
    })

    it('should check verification by SID instead of to', async () => {
      const mockCheck = createMockVerificationCheck({
        status: 'approved',
        valid: true,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck))

      const result = await verify.checkVerification({
        verificationSid: 'VE' + 'a'.repeat(32),
        code: '123456',
      })

      expect(result.valid).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('VerificationSid='),
        })
      )
    })

    it('should reject missing code parameter', async () => {
      await expect(
        verify.checkVerification({
          to: '+15558675310',
          code: '',
        })
      ).rejects.toThrow()
    })

    it('should reject when neither to nor verificationSid provided', async () => {
      await expect(
        verify.checkVerification({
          code: '123456',
        })
      ).rejects.toThrow()
    })

    it('should support amount and payee verification for PSD2', async () => {
      const mockCheck = createMockVerificationCheck({
        amount: '99.99',
        payee: 'Acme Corp',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck))

      const result = await verify.checkVerification({
        to: '+15558675310',
        code: '123456',
        amount: '99.99',
        payee: 'Acme Corp',
      })

      expect(result.amount).toBe('99.99')
      expect(result.payee).toBe('Acme Corp')
    })
  })

  // ============================================================================
  // INVALID CODES
  // ============================================================================

  describe('invalid codes', () => {
    it('should return valid=false for incorrect code', async () => {
      const mockCheck = createMockVerificationCheck({
        status: 'pending',
        valid: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck))

      const result = await verify.checkVerification({
        to: '+15558675310',
        code: '000000',
      })

      expect(result.valid).toBe(false)
      expect(result.status).toBe('pending')
    })

    it('should return error for non-existent verification', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60202, 'Verification not found', 404)
      )

      await expect(
        verify.checkVerification({
          to: '+15558675310',
          code: '123456',
        })
      ).rejects.toThrow(TwilioVerifyError)
    })

    it('should handle max_attempts_reached status', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60202, 'Max check attempts reached', 400)
      )

      await expect(
        verify.checkVerification({
          to: '+15558675310',
          code: '123456',
        })
      ).rejects.toThrow(TwilioVerifyError)
    })

    it('should track check attempts', async () => {
      // First attempt - wrong code
      const mockCheck1 = createMockVerificationCheck({
        status: 'pending',
        valid: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck1))

      const result1 = await verify.checkVerification({
        to: '+15558675310',
        code: '111111',
      })
      expect(result1.valid).toBe(false)

      // Subsequent attempts should be tracked
      const mockCheck2 = createMockVerificationCheck({
        status: 'pending',
        valid: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockCheck2))

      const result2 = await verify.checkVerification({
        to: '+15558675310',
        code: '222222',
      })
      expect(result2.valid).toBe(false)
    })
  })

  // ============================================================================
  // VERIFICATION EXPIRATION
  // ============================================================================

  describe('verification expiration', () => {
    it('should return expired status for timed out verification', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60203, 'Verification has expired', 400)
      )

      await expect(
        verify.checkVerification({
          to: '+15558675310',
          code: '123456',
        })
      ).rejects.toThrow('Verification has expired')
    })

    it('should include date_created and date_updated timestamps', async () => {
      const createdAt = '2024-01-01T00:00:00.000Z'
      const updatedAt = '2024-01-01T00:05:00.000Z'
      const mockVerification = createMockVerification({
        date_created: createdAt,
        date_updated: updatedAt,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(result.date_created).toBe(createdAt)
      expect(result.date_updated).toBe(updatedAt)
    })

    it('should allow fetching verification status to check expiry', async () => {
      const mockVerification = createMockVerification({
        status: 'expired',
        valid: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.fetchVerification({
        verificationSid: 'VE' + 'a'.repeat(32),
      })

      expect(result.status).toBe('expired')
    })
  })

  // ============================================================================
  // RATE LIMITING
  // ============================================================================

  describe('rate limiting', () => {
    it('should return error when rate limit exceeded', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60203, 'Rate limit exceeded', 429)
      )

      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
        })
      ).rejects.toThrow(TwilioVerifyError)
    })

    it('should support custom rate limits parameter', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        rateLimits: {
          unique_name: 'user-123',
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('RateLimits='),
        })
      )
    })

    it('should return error code 60203 for too many requests to same number', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(
          60203,
          'Max send attempts reached for this verification',
          429
        )
      )

      try {
        await verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioVerifyError)
        expect((error as TwilioVerifyError).code).toBe(60203)
      }
    })

    it('should support device IP for risk assessment', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        deviceIp: '192.168.1.1',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('DeviceIp='),
        })
      )
    })
  })

  // ============================================================================
  // CHANNEL-SPECIFIC BEHAVIOR
  // ============================================================================

  describe('channel-specific behavior', () => {
    it('should return lookup info for phone verifications', async () => {
      const mockVerification = createMockVerification({
        lookup: {
          carrier: {
            name: 'Verizon',
            type: 'mobile',
            mobile_country_code: '310',
            mobile_network_code: '012',
          },
        },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(result.lookup.carrier?.name).toBe('Verizon')
      expect(result.lookup.carrier?.type).toBe('mobile')
    })

    it('should handle SNA (Silent Network Auth) channel', async () => {
      const mockVerification = createMockVerification({
        channel: 'sna',
        sna: 'silent_network_auth_data',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.startVerification({
        to: '+15558675310',
        channel: 'sna',
      })

      expect(result.channel).toBe('sna')
      expect(result.sna).toBeDefined()
    })

    it('should reject invalid channel type', async () => {
      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'invalid' as VerifyChannel,
        })
      ).rejects.toThrow()
    })

    it('should handle different channels with same to address', async () => {
      // SMS verification
      const smsVerification = createMockVerification({ channel: 'sms' })
      mockFetch.mockResolvedValueOnce(createMockResponse(smsVerification))

      const smsResult = await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })
      expect(smsResult.channel).toBe('sms')

      // Call verification to same number
      const callVerification = createMockVerification({ channel: 'call' })
      mockFetch.mockResolvedValueOnce(createMockResponse(callVerification))

      const callResult = await verify.startVerification({
        to: '+15558675310',
        channel: 'call',
      })
      expect(callResult.channel).toBe('call')
    })
  })

  // ============================================================================
  // CANCEL AND FETCH VERIFICATION
  // ============================================================================

  describe('cancelVerification', () => {
    it('should cancel a pending verification', async () => {
      const mockVerification = createMockVerification({
        status: 'canceled',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.cancelVerification({
        verificationSid: 'VE' + 'a'.repeat(32),
      })

      expect(result.status).toBe('canceled')
    })

    it('should reject when verificationSid is missing', async () => {
      await expect(
        verify.cancelVerification({
          verificationSid: '',
        })
      ).rejects.toThrow()
    })
  })

  describe('fetchVerification', () => {
    it('should fetch verification by SID', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.fetchVerification({
        verificationSid: 'VE' + 'a'.repeat(32),
      })

      expect(result.sid).toMatch(/^VE/)
      expect(result.status).toBe('pending')
    })

    it('should return error for non-existent verification', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60202, 'Verification not found', 404)
      )

      await expect(
        verify.fetchVerification({
          verificationSid: 'VE00000000000000000000000000000000',
        })
      ).rejects.toThrow(TwilioVerifyError)
    })

    it('should reject when verificationSid is missing', async () => {
      await expect(
        verify.fetchVerification({
          verificationSid: '',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // RESEND CODE
  // ============================================================================

  describe('resendCode', () => {
    it('should resend verification code', async () => {
      const mockVerification = createMockVerification({
        send_code_attempts: [
          {
            time: new Date().toISOString(),
            channel: 'sms',
            attempt_sid: 'AT' + 'a'.repeat(32),
          },
          {
            time: new Date().toISOString(),
            channel: 'sms',
            attempt_sid: 'AT' + 'b'.repeat(32),
          },
        ],
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.resendCode({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(result.send_code_attempts.length).toBeGreaterThan(1)
    })

    it('should allow resending on different channel', async () => {
      const mockVerification = createMockVerification({
        channel: 'call',
        send_code_attempts: [
          {
            time: new Date().toISOString(),
            channel: 'sms',
            attempt_sid: 'AT' + 'a'.repeat(32),
          },
          {
            time: new Date().toISOString(),
            channel: 'call',
            attempt_sid: 'AT' + 'b'.repeat(32),
          },
        ],
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.resendCode({
        to: '+15558675310',
        channel: 'call',
      })

      expect(result.channel).toBe('call')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw TwilioVerifyError for API errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockErrorResponse(60200, 'Invalid parameter', 400)
      )

      try {
        await verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TwilioVerifyError)
        expect((error as TwilioVerifyError).code).toBe(60200)
        expect((error as TwilioVerifyError).status).toBe(400)
        expect((error as TwilioVerifyError).moreInfo).toContain('twilio.com')
      }
    })

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
        })
      ).rejects.toThrow('Network error')
    })

    it('should handle timeout errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Request timed out'))

      await expect(
        verify.startVerification({
          to: '+15558675310',
          channel: 'sms',
        })
      ).rejects.toThrow()
    })

    it('should include proper error codes', async () => {
      const errorCases = [
        { code: 60200, message: 'Invalid parameter' },
        { code: 60202, message: 'Verification not found' },
        { code: 60203, message: 'Max attempts reached' },
        { code: 60205, message: 'Service not found' },
      ]

      for (const { code, message } of errorCases) {
        mockFetch.mockResolvedValueOnce(createMockErrorResponse(code, message, 400))

        try {
          await verify.startVerification({
            to: '+15558675310',
            channel: 'sms',
          })
        } catch (error) {
          expect((error as TwilioVerifyError).code).toBe(code)
        }
      }
    })
  })

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  describe('authentication', () => {
    it('should send Basic Auth header', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      )
    })

    it('should use correct API endpoint', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('verify.twilio.com'),
        expect.any(Object)
      )
    })

    it('should include service SID in endpoint path', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/Services/${TEST_SERVICE_SID}/`),
        expect.any(Object)
      )
    })
  })

  // ============================================================================
  // TESTING HELPERS
  // ============================================================================

  describe('testing helpers', () => {
    it('should support custom code for testing', async () => {
      const mockVerification = createMockVerification()
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      await verify.startVerification({
        to: '+15558675310',
        channel: 'sms',
        customCode: '999999',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('CustomCode=999999'),
        })
      )
    })

    it('should support approve verification for testing', async () => {
      const mockVerification = createMockVerification({
        status: 'approved',
        valid: true,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mockVerification))

      const result = await verify.approveVerification({
        verificationSid: 'VE' + 'a'.repeat(32),
      })

      expect(result.status).toBe('approved')
      expect(result.valid).toBe(true)
    })
  })
})
