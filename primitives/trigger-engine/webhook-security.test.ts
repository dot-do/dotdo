/**
 * Webhook Security Tests - RED Phase
 *
 * Security-critical tests for webhook receiver focusing on:
 * - Timing attack protection for signature validation
 * - Replay attack protection (timestamp/nonce)
 * - Signature algorithm confusion attacks
 * - Edge cases in signature parsing
 *
 * These tests define expected security behavior that is NOT yet implemented.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  WebhookReceiver,
  createHmacSignature,
  verifyHmacSignature,
} from './index'

// =============================================================================
// Timing Attack Protection Tests
// =============================================================================

describe('WebhookReceiver - Timing Attack Protection', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
  })

  describe('constant-time signature comparison', () => {
    it('should take same time for valid and invalid signatures of equal length', async () => {
      const secret = 'my-webhook-secret'
      const body = JSON.stringify({ event: 'push', ref: 'refs/heads/main' })

      receiver.register('/webhooks/timing', {
        secret,
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
      })

      const validSignature = await createHmacSignature(body, secret, 'sha256')
      // Create invalid signature of exact same length
      const invalidSignature = validSignature.replace(/./g, (char, i) =>
        i < 10 ? (parseInt(char, 16) ^ 1).toString(16) : char
      )

      const validRequest = new Request('https://example.com/webhooks/timing', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${validSignature}`,
        },
      })

      const invalidRequest = new Request('https://example.com/webhooks/timing', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${invalidSignature}`,
        },
      })

      // Measure time for multiple iterations to detect timing differences
      const iterations = 100
      const validTimes: number[] = []
      const invalidTimes: number[] = []

      for (let i = 0; i < iterations; i++) {
        const validStart = performance.now()
        await receiver.validate(validRequest.clone(), '/webhooks/timing')
        validTimes.push(performance.now() - validStart)

        const invalidStart = performance.now()
        await receiver.validate(invalidRequest.clone(), '/webhooks/timing')
        invalidTimes.push(performance.now() - invalidStart)
      }

      const validAvg = validTimes.reduce((a, b) => a + b, 0) / iterations
      const invalidAvg = invalidTimes.reduce((a, b) => a + b, 0) / iterations

      // Times should be within 10% of each other for timing-safe comparison
      // A timing attack would show significantly different averages
      const timeDifferenceRatio = Math.abs(validAvg - invalidAvg) / Math.max(validAvg, invalidAvg)
      expect(timeDifferenceRatio).toBeLessThan(0.1)
    })

    it('should use constant-time comparison even for completely wrong signatures', async () => {
      const secret = 'test-secret'
      const body = '{"test": true}'

      // Completely wrong signature - all zeros
      const wrongSignature = '0'.repeat(64)
      const isValid = await verifyHmacSignature(body, secret, wrongSignature, 'sha256')

      expect(isValid).toBe(false)
      // The implementation should still take constant time
    })
  })
})

// =============================================================================
// Advanced Replay Protection Tests
// =============================================================================

describe('WebhookReceiver - Advanced Replay Protection', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('nonce expiration', () => {
    it('should expire nonces after TTL to prevent memory exhaustion', async () => {
      const nonceTTLMs = 5 * 60 * 1000 // 5 minutes

      receiver.register('/webhooks/nonce-ttl', {
        secret: 'secret',
        nonceHeader: 'X-Request-Id',
        replayProtection: true,
        nonceTTLMs, // NEW: TTL for nonces
      })

      const nonce = 'unique-nonce-ttl-test'

      // First request should succeed
      const request1 = new Request('https://example.com/webhooks/nonce-ttl', {
        method: 'POST',
        body: JSON.stringify({ event: 'test1' }),
        headers: { 'X-Request-Id': nonce },
      })
      const result1 = await receiver.handle(request1, '/webhooks/nonce-ttl')
      expect(result1.success).toBe(true)

      // Same nonce immediately after should fail (replay)
      const request2 = new Request('https://example.com/webhooks/nonce-ttl', {
        method: 'POST',
        body: JSON.stringify({ event: 'test2' }),
        headers: { 'X-Request-Id': nonce },
      })
      const result2 = await receiver.handle(request2, '/webhooks/nonce-ttl')
      expect(result2.success).toBe(false)

      // Advance time past TTL
      vi.advanceTimersByTime(nonceTTLMs + 1000)

      // Same nonce after TTL should succeed (nonce expired)
      const request3 = new Request('https://example.com/webhooks/nonce-ttl', {
        method: 'POST',
        body: JSON.stringify({ event: 'test3' }),
        headers: { 'X-Request-Id': nonce },
      })
      const result3 = await receiver.handle(request3, '/webhooks/nonce-ttl')
      expect(result3.success).toBe(true)
    })

    it('should track nonce count and report statistics', async () => {
      receiver.register('/webhooks/stats', {
        secret: 'secret',
        nonceHeader: 'X-Request-Id',
        replayProtection: true,
      })

      // Add multiple unique nonces
      for (let i = 0; i < 10; i++) {
        const request = new Request('https://example.com/webhooks/stats', {
          method: 'POST',
          body: JSON.stringify({ i }),
          headers: { 'X-Request-Id': `nonce-${i}` },
        })
        await receiver.handle(request, '/webhooks/stats')
      }

      const stats = receiver.getStats('/webhooks/stats')
      expect(stats.storedNonces).toBe(10)
      expect(stats.replayAttemptsBlocked).toBe(0)
    })
  })

  describe('combined timestamp and nonce protection', () => {
    it('should require both valid timestamp AND unique nonce', async () => {
      receiver.register('/webhooks/combined', {
        secret: 'secret',
        nonceHeader: 'X-Request-Id',
        timestampHeader: 'X-Timestamp',
        timestampWindowMs: 5 * 60 * 1000, // 5 minutes
        replayProtection: true,
      })

      const now = Date.now()

      // Valid timestamp + unique nonce = success
      const request1 = new Request('https://example.com/webhooks/combined', {
        method: 'POST',
        body: JSON.stringify({ event: 'test1' }),
        headers: {
          'X-Request-Id': 'nonce-1',
          'X-Timestamp': String(now),
        },
      })
      const result1 = await receiver.handle(request1, '/webhooks/combined')
      expect(result1.success).toBe(true)

      // Valid timestamp + duplicate nonce = fail
      const request2 = new Request('https://example.com/webhooks/combined', {
        method: 'POST',
        body: JSON.stringify({ event: 'test2' }),
        headers: {
          'X-Request-Id': 'nonce-1',
          'X-Timestamp': String(now + 1000),
        },
      })
      const result2 = await receiver.handle(request2, '/webhooks/combined')
      expect(result2.success).toBe(false)
      expect(result2.error).toMatch(/replay|duplicate/i)

      // Invalid timestamp + unique nonce = fail
      const oldTimestamp = now - 10 * 60 * 1000 // 10 minutes ago
      const request3 = new Request('https://example.com/webhooks/combined', {
        method: 'POST',
        body: JSON.stringify({ event: 'test3' }),
        headers: {
          'X-Request-Id': 'nonce-2',
          'X-Timestamp': String(oldTimestamp),
        },
      })
      const result3 = await receiver.handle(request3, '/webhooks/combined')
      expect(result3.success).toBe(false)
      expect(result3.error).toMatch(/timestamp|expired/i)
    })

    it('should prevent timestamp manipulation for replay attacks', async () => {
      receiver.register('/webhooks/ts-replay', {
        secret: 'secret',
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
        timestampHeader: 'X-Timestamp',
        timestampWindowMs: 5 * 60 * 1000,
        includeTimestampInSignature: true, // NEW: Include timestamp in signature
      })

      const body = JSON.stringify({ event: 'test' })
      const originalTimestamp = Date.now()
      const secret = 'secret'

      // Create signature with original timestamp
      const signaturePayload = `${originalTimestamp}.${body}`
      const signature = await createHmacSignature(signaturePayload, secret, 'sha256')

      // Request with original timestamp should work
      const request1 = new Request('https://example.com/webhooks/ts-replay', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signature}`,
          'X-Timestamp': String(originalTimestamp),
        },
      })
      const result1 = await receiver.handle(request1, '/webhooks/ts-replay')
      expect(result1.success).toBe(true)

      // Same signature but modified timestamp should fail
      const request2 = new Request('https://example.com/webhooks/ts-replay', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signature}`,
          'X-Timestamp': String(Date.now()), // Different timestamp
        },
      })
      const result2 = await receiver.handle(request2, '/webhooks/ts-replay')
      expect(result2.success).toBe(false)
      expect(result2.error).toMatch(/signature|invalid/i)
    })
  })

  describe('future timestamp rejection', () => {
    it('should reject timestamps too far in the future', async () => {
      receiver.register('/webhooks/future', {
        secret: 'secret',
        timestampHeader: 'X-Timestamp',
        timestampWindowMs: 5 * 60 * 1000, // 5 minutes
        rejectFutureTimestamps: true, // NEW: Explicit future rejection
      })

      const futureTimestamp = Date.now() + 10 * 60 * 1000 // 10 minutes in future
      const request = new Request('https://example.com/webhooks/future', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: {
          'X-Timestamp': String(futureTimestamp),
        },
      })

      const result = await receiver.handle(request, '/webhooks/future')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/future|timestamp/i)
    })
  })
})

// =============================================================================
// Signature Algorithm Confusion Attacks
// =============================================================================

describe('WebhookReceiver - Algorithm Confusion Protection', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
  })

  describe('algorithm downgrade prevention', () => {
    it('should reject SHA-1 signature when SHA-256 is configured', async () => {
      const secret = 'my-secret'
      const body = JSON.stringify({ event: 'test' })

      receiver.register('/webhooks/sha256-only', {
        secret,
        signatureHeader: 'X-Hub-Signature-256',
        signatureAlgorithm: 'sha256',
        strictAlgorithm: true, // NEW: Enforce exact algorithm match
      })

      // Create SHA-1 signature and try to pass it off
      const sha1Signature = await createHmacSignature(body, secret, 'sha1')
      const request = new Request('https://example.com/webhooks/sha256-only', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha1=${sha1Signature}`, // Wrong algorithm prefix
        },
      })

      const isValid = await receiver.validate(request, '/webhooks/sha256-only')
      expect(isValid).toBe(false)
    })

    it('should validate algorithm prefix matches configured algorithm', async () => {
      const secret = 'my-secret'
      const body = JSON.stringify({ event: 'test' })

      receiver.register('/webhooks/validate-prefix', {
        secret,
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
        validateAlgorithmPrefix: true, // NEW: Validate prefix matches config
      })

      const sha256Signature = await createHmacSignature(body, secret, 'sha256')

      // Mismatched prefix should fail
      const request1 = new Request('https://example.com/webhooks/validate-prefix', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha1=${sha256Signature}`, // Says sha1 but is sha256
        },
      })
      const result1 = await receiver.validate(request1, '/webhooks/validate-prefix')
      expect(result1).toBe(false)

      // Correct prefix should pass
      const request2 = new Request('https://example.com/webhooks/validate-prefix', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${sha256Signature}`,
        },
      })
      const result2 = await receiver.validate(request2, '/webhooks/validate-prefix')
      expect(result2).toBe(true)
    })
  })

  describe('signature format validation', () => {
    it('should reject signatures without algorithm prefix when required', async () => {
      const secret = 'my-secret'
      const body = JSON.stringify({ event: 'test' })

      receiver.register('/webhooks/require-prefix', {
        secret,
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
        requireAlgorithmPrefix: true, // NEW: Require algo=signature format
      })

      const signature = await createHmacSignature(body, secret, 'sha256')

      // No prefix - should fail
      const request1 = new Request('https://example.com/webhooks/require-prefix', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature, // No prefix
        },
      })
      const result1 = await receiver.validate(request1, '/webhooks/require-prefix')
      expect(result1).toBe(false)

      // With prefix - should pass
      const request2 = new Request('https://example.com/webhooks/require-prefix', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signature}`,
        },
      })
      const result2 = await receiver.validate(request2, '/webhooks/require-prefix')
      expect(result2).toBe(true)
    })

    it('should reject malformed signature formats', async () => {
      const secret = 'my-secret'
      const body = JSON.stringify({ event: 'test' })

      receiver.register('/webhooks/format', {
        secret,
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
      })

      const malformedSignatures = [
        'sha256=', // Empty signature
        '=abc123', // Empty algorithm
        'sha256=xyz!@#', // Invalid hex characters
        'sha256=12345', // Too short
        'sha256=' + 'a'.repeat(65), // SHA-256 should be 64 hex chars
        'sha256 = abc', // Spaces around equals
        'SHA256=abc', // Case sensitivity
      ]

      for (const sig of malformedSignatures) {
        const request = new Request('https://example.com/webhooks/format', {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': sig,
          },
        })

        const result = await receiver.validate(request, '/webhooks/format')
        expect(result).toBe(false)
      }
    })
  })
})

// =============================================================================
// Webhook Parsing Security
// =============================================================================

describe('WebhookReceiver - Parsing Security', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
  })

  describe('JSON parsing protection', () => {
    it('should reject deeply nested JSON to prevent DoS', async () => {
      receiver.register('/webhooks/json-depth', {
        secret: 'secret',
        maxJsonDepth: 10, // NEW: Max nesting depth
      })

      // Create deeply nested JSON
      let nested = { value: 'deep' }
      for (let i = 0; i < 20; i++) {
        nested = { nested } as unknown as typeof nested
      }

      const request = new Request('https://example.com/webhooks/json-depth', {
        method: 'POST',
        body: JSON.stringify(nested),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/json-depth')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/depth|nested|too deep/i)
    })

    it('should reject JSON with too many keys to prevent DoS', async () => {
      receiver.register('/webhooks/json-keys', {
        secret: 'secret',
        maxJsonKeys: 100, // NEW: Max total keys
      })

      // Create object with many keys
      const manyKeys: Record<string, number> = {}
      for (let i = 0; i < 200; i++) {
        manyKeys[`key_${i}`] = i
      }

      const request = new Request('https://example.com/webhooks/json-keys', {
        method: 'POST',
        body: JSON.stringify(manyKeys),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/json-keys')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/keys|properties|too many/i)
    })

    it('should handle __proto__ pollution attempts safely', async () => {
      receiver.register('/webhooks/proto', {
        secret: 'secret',
        sanitizeJson: true, // NEW: Remove dangerous keys
      })

      const maliciousBody = JSON.stringify({
        '__proto__': { admin: true },
        'constructor': { prototype: { admin: true } },
        'normal': 'value',
      })

      const request = new Request('https://example.com/webhooks/proto', {
        method: 'POST',
        body: maliciousBody,
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/proto')
      expect(result.success).toBe(true)

      const data = result.data as Record<string, unknown>
      // Dangerous keys should be removed or neutralized
      expect(data.__proto__).toBeUndefined()
      expect(data.constructor).toBeUndefined()
      expect(data.normal).toBe('value')
    })
  })

  describe('content-type enforcement', () => {
    it('should reject mismatched content-type when strict mode enabled', async () => {
      receiver.register('/webhooks/strict-ct', {
        secret: 'secret',
        strictContentType: true, // NEW: Enforce content-type matches body
        allowedContentTypes: ['application/json'],
      })

      // Send JSON body but with wrong content-type
      const request = new Request('https://example.com/webhooks/strict-ct', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        headers: { 'Content-Type': 'text/plain' },
      })

      const result = await receiver.handle(request, '/webhooks/strict-ct')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/content-type|not allowed/i)
    })

    it('should require content-type header when configured', async () => {
      receiver.register('/webhooks/require-ct', {
        secret: 'secret',
        requireContentType: true, // NEW: Require content-type header
      })

      const request = new Request('https://example.com/webhooks/require-ct', {
        method: 'POST',
        body: JSON.stringify({ event: 'test' }),
        // No Content-Type header
      })

      const result = await receiver.handle(request, '/webhooks/require-ct')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/content-type|missing|required/i)
    })
  })
})

// =============================================================================
// Rate Limiting and DoS Protection
// =============================================================================

describe('WebhookReceiver - Rate Limiting', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('per-path rate limiting', () => {
    it('should rate limit requests per webhook path', async () => {
      receiver.register('/webhooks/rate-limited', {
        secret: 'secret',
        rateLimit: {
          maxRequests: 10,
          windowMs: 60_000, // 1 minute
        },
      })

      // First 10 requests should succeed
      for (let i = 0; i < 10; i++) {
        const request = new Request('https://example.com/webhooks/rate-limited', {
          method: 'POST',
          body: JSON.stringify({ i }),
          headers: { 'Content-Type': 'application/json' },
        })
        const result = await receiver.handle(request, '/webhooks/rate-limited')
        expect(result.success).toBe(true)
      }

      // 11th request should be rate limited
      const request = new Request('https://example.com/webhooks/rate-limited', {
        method: 'POST',
        body: JSON.stringify({ i: 10 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await receiver.handle(request, '/webhooks/rate-limited')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/rate limit|too many/i)
    })

    it('should reset rate limit after window expires', async () => {
      receiver.register('/webhooks/rate-reset', {
        secret: 'secret',
        rateLimit: {
          maxRequests: 5,
          windowMs: 60_000,
        },
      })

      // Exhaust rate limit
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://example.com/webhooks/rate-reset', {
          method: 'POST',
          body: JSON.stringify({ i }),
          headers: { 'Content-Type': 'application/json' },
        })
        await receiver.handle(request, '/webhooks/rate-reset')
      }

      // Should be rate limited
      const request1 = new Request('https://example.com/webhooks/rate-reset', {
        method: 'POST',
        body: JSON.stringify({ i: 5 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const result1 = await receiver.handle(request1, '/webhooks/rate-reset')
      expect(result1.success).toBe(false)

      // Advance time past window
      vi.advanceTimersByTime(61_000)

      // Should work again
      const request2 = new Request('https://example.com/webhooks/rate-reset', {
        method: 'POST',
        body: JSON.stringify({ i: 6 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const result2 = await receiver.handle(request2, '/webhooks/rate-reset')
      expect(result2.success).toBe(true)
    })

    it('should return rate limit headers', async () => {
      receiver.register('/webhooks/headers', {
        secret: 'secret',
        rateLimit: {
          maxRequests: 10,
          windowMs: 60_000,
        },
      })

      const request = new Request('https://example.com/webhooks/headers', {
        method: 'POST',
        body: JSON.stringify({ test: true }),
        headers: { 'Content-Type': 'application/json' },
      })

      const result = await receiver.handle(request, '/webhooks/headers')
      expect(result.success).toBe(true)
      expect(result.rateLimitHeaders).toBeDefined()
      expect(result.rateLimitHeaders!['X-RateLimit-Limit']).toBe(10)
      expect(result.rateLimitHeaders!['X-RateLimit-Remaining']).toBe(9)
      expect(result.rateLimitHeaders!['X-RateLimit-Reset']).toBeDefined()
    })
  })

  describe('signature validation rate limiting', () => {
    it('should rate limit failed signature validations per source IP', async () => {
      receiver.register('/webhooks/sig-rate', {
        secret: 'secret',
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
        signatureValidationRateLimit: {
          maxFailures: 5,
          windowMs: 60_000,
          blockDurationMs: 5 * 60_000, // Block for 5 minutes after too many failures
        },
      })

      // Simulate 5 failed signature validations
      for (let i = 0; i < 5; i++) {
        const request = new Request('https://example.com/webhooks/sig-rate', {
          method: 'POST',
          body: JSON.stringify({ i }),
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': 'sha256=invalid',
            'X-Forwarded-For': '192.168.1.100',
          },
        })
        await receiver.handle(request, '/webhooks/sig-rate')
      }

      // Even with valid signature, should be blocked
      const body = JSON.stringify({ i: 5 })
      const validSignature = await createHmacSignature(body, 'secret', 'sha256')
      const request = new Request('https://example.com/webhooks/sig-rate', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${validSignature}`,
          'X-Forwarded-For': '192.168.1.100',
        },
      })

      const result = await receiver.handle(request, '/webhooks/sig-rate')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/blocked|too many failures/i)
    })
  })
})

// =============================================================================
// Secret Rotation Support
// =============================================================================

describe('WebhookReceiver - Secret Rotation', () => {
  let receiver: WebhookReceiver

  beforeEach(() => {
    receiver = new WebhookReceiver()
  })

  describe('multiple secrets for rotation', () => {
    it('should accept signature from any of multiple configured secrets', async () => {
      const oldSecret = 'old-webhook-secret'
      const newSecret = 'new-webhook-secret'
      const body = JSON.stringify({ event: 'test' })

      receiver.register('/webhooks/rotation', {
        secrets: [newSecret, oldSecret], // NEW: Array of secrets for rotation
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
      })

      // Request signed with old secret should still work
      const oldSignature = await createHmacSignature(body, oldSecret, 'sha256')
      const request1 = new Request('https://example.com/webhooks/rotation', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${oldSignature}`,
        },
      })
      const result1 = await receiver.validate(request1, '/webhooks/rotation')
      expect(result1).toBe(true)

      // Request signed with new secret should work
      const newSignature = await createHmacSignature(body, newSecret, 'sha256')
      const request2 = new Request('https://example.com/webhooks/rotation', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${newSignature}`,
        },
      })
      const result2 = await receiver.validate(request2, '/webhooks/rotation')
      expect(result2).toBe(true)

      // Invalid secret should fail
      const wrongSignature = await createHmacSignature(body, 'wrong-secret', 'sha256')
      const request3 = new Request('https://example.com/webhooks/rotation', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${wrongSignature}`,
        },
      })
      const result3 = await receiver.validate(request3, '/webhooks/rotation')
      expect(result3).toBe(false)
    })

    it('should use timing-safe comparison even with multiple secrets', async () => {
      // This ensures the timing attack protection still works with rotation
      receiver.register('/webhooks/rotation-timing', {
        secrets: ['secret1', 'secret2', 'secret3'],
        signatureHeader: 'X-Signature',
        signatureAlgorithm: 'sha256',
      })

      const body = JSON.stringify({ event: 'test' })

      // Valid signature with first secret
      const validSignature = await createHmacSignature(body, 'secret1', 'sha256')
      // Invalid signature
      const invalidSignature = 'a'.repeat(64)

      const iterations = 50
      const validTimes: number[] = []
      const invalidTimes: number[] = []

      for (let i = 0; i < iterations; i++) {
        const validRequest = new Request('https://example.com/webhooks/rotation-timing', {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': `sha256=${validSignature}`,
          },
        })
        const validStart = performance.now()
        await receiver.validate(validRequest, '/webhooks/rotation-timing')
        validTimes.push(performance.now() - validStart)

        const invalidRequest = new Request('https://example.com/webhooks/rotation-timing', {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': `sha256=${invalidSignature}`,
          },
        })
        const invalidStart = performance.now()
        await receiver.validate(invalidRequest, '/webhooks/rotation-timing')
        invalidTimes.push(performance.now() - invalidStart)
      }

      const validAvg = validTimes.reduce((a, b) => a + b, 0) / iterations
      const invalidAvg = invalidTimes.reduce((a, b) => a + b, 0) / iterations

      // Times should be within 20% for timing-safe comparison with multiple secrets
      const timeDifferenceRatio = Math.abs(validAvg - invalidAvg) / Math.max(validAvg, invalidAvg)
      expect(timeDifferenceRatio).toBeLessThan(0.2)
    })
  })
})
