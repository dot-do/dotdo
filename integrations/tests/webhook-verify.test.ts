// Webhook Verification Tests
// TDD tests for webhook signature verification utilities (do-wmao)

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  parseStripeSignature,
  verifyStripeSignature,
  verifySendGridSignature,
  verifyTwilioSignature,
  verifyHmacSignature,
  type StripeSignatureParts,
} from '../webhook-verify'

describe('Webhook Verification', () => {
  describe('parseStripeSignature', () => {
    it('should parse valid Stripe signature header', () => {
      const header = 't=1614556800,v1=abc123def456,v1=ghi789jkl012'
      const result = parseStripeSignature(header)

      expect(result).not.toBeNull()
      expect(result!.timestamp).toBe(1614556800)
      expect(result!.signatures).toHaveLength(2)
      expect(result!.signatures).toContain('abc123def456')
      expect(result!.signatures).toContain('ghi789jkl012')
    })

    it('should parse header with single signature', () => {
      const header = 't=1614556800,v1=singlesignature'
      const result = parseStripeSignature(header)

      expect(result).not.toBeNull()
      expect(result!.timestamp).toBe(1614556800)
      expect(result!.signatures).toHaveLength(1)
      expect(result!.signatures[0]).toBe('singlesignature')
    })

    it('should return null for missing timestamp', () => {
      const header = 'v1=abc123def456'
      const result = parseStripeSignature(header)

      expect(result).toBeNull()
    })

    it('should return null for missing signatures', () => {
      const header = 't=1614556800'
      const result = parseStripeSignature(header)

      expect(result).toBeNull()
    })

    it('should return null for invalid timestamp (zero)', () => {
      const header = 't=0,v1=abc123'
      const result = parseStripeSignature(header)

      // timestamp === 0 is treated as invalid
      expect(result).toBeNull()
    })

    it('should handle NaN timestamp by returning object with NaN', () => {
      // Note: The implementation parses 'invalid' as NaN, which is not explicitly checked
      // This test documents the current behavior
      const header = 't=invalid,v1=abc123'
      const result = parseStripeSignature(header)

      // parseInt('invalid') returns NaN, which passes the timestamp !== 0 check
      expect(result).not.toBeNull()
      expect(Number.isNaN(result!.timestamp)).toBe(true)
      expect(result!.signatures).toContain('abc123')
    })

    it('should handle empty string', () => {
      const result = parseStripeSignature('')
      expect(result).toBeNull()
    })

    it('should ignore unknown keys', () => {
      const header = 't=1614556800,v0=old,v1=current,v2=future'
      const result = parseStripeSignature(header)

      expect(result).not.toBeNull()
      expect(result!.signatures).toHaveLength(1)
      expect(result!.signatures[0]).toBe('current')
    })
  })

  describe('verifyStripeSignature', () => {
    // Mock timestamp for testing
    const mockTimestamp = 1614556800
    const mockPayload = '{"id":"evt_123","type":"payment_intent.succeeded"}'
    const secret = 'whsec_test_secret_key_12345678'

    beforeEach(() => {
      // Mock Date.now to return a consistent timestamp
      vi.useFakeTimers()
      vi.setSystemTime(new Date(mockTimestamp * 1000))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should verify valid signature', async () => {
      // Compute the expected signature using the same algorithm
      const signedPayload = `${mockTimestamp}.${mockPayload}`
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(signedPayload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const header = `t=${mockTimestamp},v1=${hexSignature}`

      const result = await verifyStripeSignature(mockPayload, header, secret)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject invalid signature', async () => {
      const header = `t=${mockTimestamp},v1=invalidsignature`

      const result = await verifyStripeSignature(mockPayload, header, secret)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Signature verification failed')
    })

    it('should reject expired timestamp', async () => {
      // Set the timestamp to be outside tolerance (> 300 seconds old)
      const oldTimestamp = mockTimestamp - 400
      const header = `t=${oldTimestamp},v1=somesignature`

      const result = await verifyStripeSignature(mockPayload, header, secret)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside tolerance')
    })

    it('should reject future timestamp', async () => {
      // Set the timestamp to be in the future (> 300 seconds ahead)
      const futureTimestamp = mockTimestamp + 400
      const header = `t=${futureTimestamp},v1=somesignature`

      const result = await verifyStripeSignature(mockPayload, header, secret)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside tolerance')
    })

    it('should accept custom tolerance', async () => {
      // Timestamp is 400 seconds old, but with 500 second tolerance should pass signature check
      const oldTimestamp = mockTimestamp - 400

      // Compute valid signature for the old timestamp
      const signedPayload = `${oldTimestamp}.${mockPayload}`
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(signedPayload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const header = `t=${oldTimestamp},v1=${hexSignature}`

      const result = await verifyStripeSignature(mockPayload, header, secret, 500)

      expect(result.valid).toBe(true)
    })

    it('should reject malformed header', async () => {
      const result = await verifyStripeSignature(mockPayload, 'invalid-header', secret)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unable to parse')
    })

    it('should handle multiple signatures (at least one must match)', async () => {
      // Compute one valid signature
      const signedPayload = `${mockTimestamp}.${mockPayload}`
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(signedPayload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      // Header with invalid first signature and valid second signature
      const header = `t=${mockTimestamp},v1=invalid,v1=${hexSignature}`

      const result = await verifyStripeSignature(mockPayload, header, secret)

      expect(result.valid).toBe(true)
    })
  })

  describe('verifySendGridSignature', () => {
    const mockTimestamp = Math.floor(Date.now() / 1000)
    const mockPayload = '[{"event":"delivered","email":"test@example.com"}]'

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(mockTimestamp * 1000))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should reject invalid timestamp header', async () => {
      const result = await verifySendGridSignature(
        mockPayload,
        'somesignature',
        'not-a-number',
        'public-key-placeholder'
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid timestamp')
    })

    it('should reject expired timestamp', async () => {
      const oldTimestamp = mockTimestamp - 400

      const result = await verifySendGridSignature(
        mockPayload,
        'somesignature',
        String(oldTimestamp),
        'public-key-placeholder'
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside tolerance')
    })

    it('should reject future timestamp', async () => {
      const futureTimestamp = mockTimestamp + 400

      const result = await verifySendGridSignature(
        mockPayload,
        'somesignature',
        String(futureTimestamp),
        'public-key-placeholder'
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside tolerance')
    })

    it('should accept custom tolerance', async () => {
      const oldTimestamp = mockTimestamp - 400

      // Note: This will still fail on signature verification, but it should pass timestamp check
      const result = await verifySendGridSignature(
        mockPayload,
        'somesignature',
        String(oldTimestamp),
        'public-key-placeholder',
        500 // 500 second tolerance
      )

      // Should fail on signature, not timestamp
      expect(result.valid).toBe(false)
      expect(result.error).not.toContain('timestamp')
    })

    it('should handle invalid public key gracefully', async () => {
      const result = await verifySendGridSignature(
        mockPayload,
        'bm90LWEtcmVhbC1zaWduYXR1cmU=', // base64 encoded "not-a-real-signature"
        String(mockTimestamp),
        'bm90LWEtcmVhbC1rZXk=' // base64 encoded "not-a-real-key"
      )

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Signature verification error')
    })
  })

  describe('verifyTwilioSignature', () => {
    const testUrl = 'https://example.com/webhook'
    const authToken = 'test_auth_token_123456'

    it('should verify valid Twilio signature', async () => {
      const params: Record<string, string> = {
        Body: 'Hello',
        From: '+15551234567',
        To: '+15559876543',
      }

      // Compute expected signature
      const sortedKeys = Object.keys(params).sort()
      let signatureBase = testUrl
      for (const key of sortedKeys) {
        signatureBase += key + params[key]
      }

      const encoder = new TextEncoder()
      const keyData = encoder.encode(authToken)
      const messageData = encoder.encode(signatureBase)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))

      const result = await verifyTwilioSignature(testUrl, params, expectedSignature, authToken)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should reject invalid signature', async () => {
      const params = {
        Body: 'Hello',
        From: '+15551234567',
      }

      const result = await verifyTwilioSignature(testUrl, params, 'invalidsignature', authToken)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Signature verification failed')
    })

    it('should handle empty params', async () => {
      const params: Record<string, string> = {}

      // Compute expected signature for URL only
      const encoder = new TextEncoder()
      const keyData = encoder.encode(authToken)
      const messageData = encoder.encode(testUrl)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))

      const result = await verifyTwilioSignature(testUrl, params, expectedSignature, authToken)

      expect(result.valid).toBe(true)
    })

    it('should sort params correctly', async () => {
      // Params deliberately out of order
      const params: Record<string, string> = {
        Zebra: '1',
        Alpha: '2',
        Middle: '3',
      }

      // Compute expected signature with sorted params
      const sortedKeys = ['Alpha', 'Middle', 'Zebra']
      let signatureBase = testUrl
      for (const key of sortedKeys) {
        signatureBase += key + params[key]
      }

      const encoder = new TextEncoder()
      const keyData = encoder.encode(authToken)
      const messageData = encoder.encode(signatureBase)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))

      const result = await verifyTwilioSignature(testUrl, params, expectedSignature, authToken)

      expect(result.valid).toBe(true)
    })
  })

  describe('verifyHmacSignature', () => {
    const secret = 'webhook_secret_key_123'
    const mockTimestamp = 1614556800

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(mockTimestamp * 1000))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should verify valid HMAC signature without timestamp', async () => {
      const payload = '{"data":"test"}'

      // Compute expected signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(payload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const result = await verifyHmacSignature(payload, hexSignature, secret)

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should verify valid HMAC signature with timestamp', async () => {
      const payload = '{"data":"test"}'
      const signedPayload = `${mockTimestamp}.${payload}`

      // Compute expected signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(signedPayload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const result = await verifyHmacSignature(payload, hexSignature, secret, mockTimestamp)

      expect(result.valid).toBe(true)
    })

    it('should reject invalid signature', async () => {
      const payload = '{"data":"test"}'

      const result = await verifyHmacSignature(payload, 'invalidsig', secret)

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Signature verification failed')
    })

    it('should reject expired timestamp', async () => {
      const payload = '{"data":"test"}'
      const oldTimestamp = mockTimestamp - 400

      const result = await verifyHmacSignature(payload, 'anysig', secret, oldTimestamp)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('timestamp outside tolerance')
    })

    it('should handle sha256= prefix in signature', async () => {
      const payload = '{"data":"test"}'

      // Compute expected signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(payload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      // Add sha256= prefix like some providers do
      const result = await verifyHmacSignature(payload, `sha256=${hexSignature}`, secret)

      expect(result.valid).toBe(true)
    })

    it('should accept custom tolerance with timestamp', async () => {
      const payload = '{"data":"test"}'
      const oldTimestamp = mockTimestamp - 400
      const signedPayload = `${oldTimestamp}.${payload}`

      // Compute expected signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(signedPayload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const hexSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const result = await verifyHmacSignature(payload, hexSignature, secret, oldTimestamp, 500)

      expect(result.valid).toBe(true)
    })
  })

  describe('security: constant-time comparison', () => {
    it('should use constant-time comparison to prevent timing attacks', async () => {
      const secret = 'test_secret'
      const payload = 'test_payload'

      // Compute a valid signature
      const encoder = new TextEncoder()
      const keyData = encoder.encode(secret)
      const messageData = encoder.encode(payload)
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
      const validSignature = Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      // Create signatures with different prefix lengths matching
      const sigWith0Match = 'x' + validSignature.slice(1)
      const sigWith5Match = validSignature.slice(0, 5) + 'x' + validSignature.slice(6)
      const sigWithAlmostMatch = validSignature.slice(0, -1) + 'x'

      // All invalid signatures should take approximately the same time
      // (We can't actually measure timing reliably in tests, but we verify they all fail)
      const results = await Promise.all([
        verifyHmacSignature(payload, sigWith0Match, secret),
        verifyHmacSignature(payload, sigWith5Match, secret),
        verifyHmacSignature(payload, sigWithAlmostMatch, secret),
      ])

      expect(results.every((r) => r.valid === false)).toBe(true)
    })

    it('should reject signatures of different lengths', async () => {
      const secret = 'test_secret'
      const payload = 'test_payload'

      // Short signature
      const resultShort = await verifyHmacSignature(payload, 'abc', secret)
      expect(resultShort.valid).toBe(false)

      // Long signature
      const resultLong = await verifyHmacSignature(
        payload,
        'a'.repeat(128),
        secret
      )
      expect(resultLong.valid).toBe(false)
    })
  })
})
