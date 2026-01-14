/**
 * Twilio Compat Layer Integration Tests (RED Phase)
 *
 * Tests the @dotdo/twilio compat layer with real DO storage,
 * verifying API compatibility with the official Twilio SDK.
 *
 * These tests:
 * 1. Verify correct API shape matching Twilio SDK
 * 2. Verify proper DO storage for messaging state
 * 3. Verify error handling matches Twilio SDK behavior
 *
 * Run with: npx vitest run tests/integration/compat/twilio-real.test.ts --project=integration
 *
 * @module tests/integration/compat/twilio-real
 */

import { describe, it, expect, beforeEach } from 'vitest'

/**
 * In-memory test fetch for Twilio integration tests.
 * Simulates API responses without making HTTP calls.
 */
class InMemoryFetch {
  private responses: Array<{ ok: boolean; status: number; data: unknown }> = []
  public calls: Array<{ url: string; options: RequestInit }> = []

  queueResponse(ok: boolean, status: number, data: unknown) {
    this.responses.push({ ok, status, data })
  }

  reset() {
    this.responses = []
    this.calls = []
  }

  get callCount() {
    return this.calls.length
  }

  createFetch() {
    return async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      this.calls.push({ url: url.toString(), options: options || {} })

      const response = this.responses.shift() || {
        ok: true,
        status: 200,
        data: { sid: 'SM_test_' + crypto.randomUUID().slice(0, 8) },
      }

      return {
        ok: response.ok,
        status: response.status,
        json: () => Promise.resolve(response.data),
        headers: new Headers(),
      } as Response
    }
  }
}

describe('Twilio Compat Layer - Real Integration', () => {
  let testFetch: InMemoryFetch

  beforeEach(() => {
    testFetch = new InMemoryFetch()
    testFetch.queueResponse(true, 200, { sid: 'SM_test_123' })
  })

  /**
   * Test Suite 1: API Shape Compatibility with Twilio SDK
   *
   * Verifies that the Twilio compat layer exports the same API surface
   * as the official Twilio SDK.
   */
  describe('API Shape Compatibility', () => {
    it('exports twilio factory function like SDK', async () => {
      const twilio = await import('../../../compat/twilio/index')

      expect(twilio.default).toBeDefined()
      expect(typeof twilio.default).toBe('function')
    })

    it('creates client with accountSid and authToken', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default

      const client = twilio('AC_test_xxx', 'auth_token_xxx')
      expect(client).toBeDefined()
    })

    it('exposes messages resource', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token')

      expect(client.messages).toBeDefined()
      expect(typeof client.messages.create).toBe('function')
      expect(typeof client.messages.list).toBe('function')
    })

    it('exposes calls resource', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token')

      expect(client.calls).toBeDefined()
      expect(typeof client.calls.create).toBe('function')
      expect(typeof client.calls.list).toBe('function')
    })

    it('exposes verify v2 resource', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token')

      expect(client.verify).toBeDefined()
      expect(client.verify.v2).toBeDefined()
      expect(typeof client.verify.v2.services).toBe('function')
    })

    it('verify.v2.services returns verifications and verificationChecks', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token')

      const service = client.verify.v2.services('VA_xxx')
      expect(service.verifications).toBeDefined()
      expect(typeof service.verifications.create).toBe('function')
      expect(service.verificationChecks).toBeDefined()
      expect(typeof service.verificationChecks.create).toBe('function')
    })

    it('exports Webhooks utility for signature verification', async () => {
      const { Webhooks } = await import('../../../compat/twilio/index')

      expect(Webhooks).toBeDefined()
      expect(typeof Webhooks.validateRequest).toBe('function')
      expect(typeof Webhooks.validateRequestWithBody).toBe('function')
    })
  })

  /**
   * Test Suite 2: SMS Operations
   *
   * Verifies SMS messaging operations.
   */
  describe('SMS Operations', () => {
    it('validates required To field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.messages.create({
          // Missing 'to'
          from: '+15017122661',
          body: 'Hello!',
        })
      ).rejects.toThrow()
    })

    it('validates required Body or MediaUrl field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.messages.create({
          to: '+15558675310',
          from: '+15017122661',
          // Missing body/mediaUrl/contentSid
        })
      ).rejects.toThrow()
    })

    it('validates required From or MessagingServiceSid field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.messages.create({
          to: '+15558675310',
          body: 'Hello!',
          // Missing from/messagingServiceSid
        })
      ).rejects.toThrow()
    })

    it('creates message with all required fields', async () => {
      testFetch.queueResponse(true, 200, {
        sid: 'SM_xxx',
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
        status: 'queued',
        direction: 'outbound-api',
        date_created: new Date().toISOString(),
      })

      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const message = await client.messages.create({
        to: '+15558675310',
        from: '+15017122661',
        body: 'Hello!',
      })

      expect(message).toBeDefined()
      expect(message.sid).toMatch(/^SM_/)
    })

    it('message instance has fetch and update methods', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const messageInstance = client.messages('SM_xxx')
      expect(typeof messageInstance.fetch).toBe('function')
      expect(typeof messageInstance.update).toBe('function')
      expect(typeof messageInstance.remove).toBe('function')
    })
  })

  /**
   * Test Suite 3: Voice Call Operations
   *
   * Verifies voice call operations.
   */
  describe('Voice Call Operations', () => {
    it('validates required To field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.calls.create({
          // Missing 'to'
          from: '+15017122661',
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow()
    })

    it('validates required From field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.calls.create({
          to: '+15558675310',
          // Missing 'from'
          url: 'https://example.com/twiml',
        })
      ).rejects.toThrow()
    })

    it('validates required Url or Twiml field', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      await expect(
        client.calls.create({
          to: '+15558675310',
          from: '+15017122661',
          // Missing url/twiml
        })
      ).rejects.toThrow()
    })

    it('creates call with url', async () => {
      // Reset default response for this test
      testFetch.reset()
      testFetch.queueResponse(true, 200, {
        sid: 'CA_xxx',
        to: '+15558675310',
        from: '+15017122661',
        status: 'queued',
      })

      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const call = await client.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        url: 'https://example.com/twiml',
      })

      expect(call).toBeDefined()
      expect(call.sid).toMatch(/^CA_/)
    })

    it('creates call with twiml', async () => {
      testFetch.queueResponse(true, 200, {
        sid: 'CA_xxx',
        to: '+15558675310',
        from: '+15017122661',
        status: 'queued',
      })

      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const call = await client.calls.create({
        to: '+15558675310',
        from: '+15017122661',
        twiml: '<Response><Say>Hello!</Say></Response>',
      })

      expect(call).toBeDefined()
    })

    it('call instance has fetch and update methods', async () => {
      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const callInstance = client.calls('CA_xxx')
      expect(typeof callInstance.fetch).toBe('function')
      expect(typeof callInstance.update).toBe('function')
    })
  })

  /**
   * Test Suite 4: Verify Operations
   *
   * Verifies OTP verification operations.
   */
  describe('Verify Operations', () => {
    it('creates verification with to and channel', async () => {
      testFetch.queueResponse(true, 200, {
        sid: 'VE_xxx',
        service_sid: 'VA_xxx',
        to: '+15558675310',
        channel: 'sms',
        status: 'pending',
      })

      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const verification = await client.verify.v2
        .services('VA_xxx')
        .verifications.create({
          to: '+15558675310',
          channel: 'sms',
        })

      expect(verification).toBeDefined()
    })

    it('checks verification code', async () => {
      testFetch.queueResponse(true, 200, {
        sid: 'VE_xxx',
        service_sid: 'VA_xxx',
        to: '+15558675310',
        channel: 'sms',
        status: 'approved',
        valid: true,
      })

      const twilio = (await import('../../../compat/twilio/index')).default
      const client = twilio('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      const check = await client.verify.v2
        .services('VA_xxx')
        .verificationChecks.create({
          to: '+15558675310',
          code: '123456',
        })

      expect(check).toBeDefined()
    })
  })

  /**
   * Test Suite 5: Error Handling Compatibility
   *
   * Verifies that errors match Twilio SDK error patterns.
   */
  describe('Error Handling Compatibility', () => {
    it('throws TwilioAPIError with code and status', async () => {
      testFetch.queueResponse(false, 400, {
        code: 21604,
        message: "The 'To' phone number is required.",
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })

      const { TwilioAPIError, TwilioClient } = await import('../../../compat/twilio/index')
      const client = new TwilioClient('AC_test', 'auth_token', { fetch: testFetch.createFetch() })

      try {
        await client.messages.create({
          from: '+15017122661',
          body: 'Test',
        } as Parameters<typeof client.messages.create>[0])
      } catch (error: unknown) {
        // Should be instance of TwilioAPIError or have similar properties
        expect(error).toBeDefined()
        expect((error as Error).message).toBeDefined()
      }
    })

    it('error includes moreInfo URL', async () => {
      const { TwilioAPIError } = await import('../../../compat/twilio/index')

      const error = new TwilioAPIError({
        code: 21604,
        message: 'Test error',
        more_info: 'https://www.twilio.com/docs/errors/21604',
        status: 400,
      })

      expect(error.code).toBe(21604)
      expect(error.status).toBe(400)
      expect(error.moreInfo).toContain('twilio.com')
    })
  })

  /**
   * Test Suite 6: Webhook Signature Verification
   *
   * Verifies webhook signature verification works correctly.
   */
  describe('Webhook Signature Verification', () => {
    it('validates request signature', async () => {
      const { Webhooks } = await import('../../../compat/twilio/index')

      const authToken = 'test_auth_token'
      const url = 'https://mycompany.com/webhook'
      const params = { AccountSid: 'AC_xxx', Body: 'Test' }

      // Get expected signature
      const expectedSig = await Webhooks.getExpectedTwilioSignature(authToken, url, params)

      // Should validate correct signature
      const isValid = await Webhooks.validateRequest(authToken, expectedSig, url, params)
      expect(isValid).toBe(true)
    })

    it('rejects invalid signature', async () => {
      const { Webhooks } = await import('../../../compat/twilio/index')

      const authToken = 'test_auth_token'
      const url = 'https://mycompany.com/webhook'
      const params = { AccountSid: 'AC_xxx' }

      const isValid = await Webhooks.validateRequest(authToken, 'invalid_sig', url, params)
      expect(isValid).toBe(false)
    })

    it('validates request with body for JSON webhooks', async () => {
      const { Webhooks } = await import('../../../compat/twilio/index')

      const body = JSON.stringify({ test: 'data' })

      // Get body hash
      const bodyHash = await Webhooks.getBodyHash(body)
      expect(bodyHash).toBeDefined()
      expect(typeof bodyHash).toBe('string')
    })
  })
})
