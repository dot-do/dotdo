/**
 * Webhook Receiver Tests - RED Phase TDD
 *
 * These tests define the webhook receiver contract including:
 * 1. HMAC-SHA256 signature validation
 * 2. HMAC-SHA1 signature validation (legacy)
 * 3. Timestamp-based replay protection
 * 4. Idempotency key deduplication
 * 5. Request body parsing (JSON, form-urlencoded)
 * 6. Header extraction for metadata
 * 7. Retry handling with exponential backoff
 * 8. Dead letter queue for failed webhooks
 *
 * All tests are expected to FAIL until lib/triggers/webhook-receiver.ts is implemented.
 *
 * @module lib/triggers/tests/webhook-receiver.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// =============================================================================
// EXPECTED TYPES (Design Contract)
// =============================================================================

/**
 * Supported HMAC hash algorithms for signature validation
 */
type SignatureAlgorithm = 'sha256' | 'sha1' | 'sha512'

/**
 * Webhook receiver configuration options
 */
interface WebhookReceiverConfig {
  /** Secret key(s) for HMAC signature validation (supports rotation) */
  secrets: string[]
  /** Hash algorithm for HMAC (default: sha256) */
  algorithm?: SignatureAlgorithm
  /** Header name containing the signature (default: X-Webhook-Signature) */
  signatureHeader?: string
  /** Header name containing the timestamp (for replay protection) */
  timestampHeader?: string
  /** Maximum age in seconds for timestamp validation (default: 300) */
  timestampToleranceSeconds?: number
  /** Header name containing idempotency key */
  idempotencyHeader?: string
  /** Enable idempotency checking (default: false) */
  enableIdempotency?: boolean
  /** TTL in milliseconds for idempotency keys (default: 86400000 = 24 hours) */
  idempotencyTTLMs?: number
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySizeBytes?: number
  /** Headers to extract as metadata */
  metadataHeaders?: string[]
  /** Enable retry handling (default: false) */
  enableRetryHandling?: boolean
  /** Retry configuration */
  retryConfig?: RetryConfig
  /** Dead letter queue handler */
  dlqHandler?: (webhook: FailedWebhook) => Promise<void>
}

/**
 * Retry configuration for failed webhook processing
 */
interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number
  /** Maximum delay in milliseconds (default: 300000) */
  maxDelayMs: number
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number
  /** Whether to add jitter to delays (default: true) */
  jitter: boolean
}

/**
 * Result of signature validation
 */
interface SignatureValidationResult {
  /** Whether the signature is valid */
  valid: boolean
  /** Error message if validation failed */
  error?: string
  /** Index of the matched secret (for rotation support) */
  matchedSecretIndex?: number
}

/**
 * Result of webhook processing
 */
interface WebhookResult<T = unknown> {
  /** Whether processing was successful */
  success: boolean
  /** Parsed and validated webhook payload */
  payload?: T
  /** Extracted metadata from headers */
  metadata?: Record<string, string>
  /** Error message if processing failed */
  error?: string
  /** Whether this was a duplicate (idempotency) */
  isDuplicate?: boolean
  /** Timestamp validation result */
  timestampValid?: boolean
}

/**
 * Failed webhook for dead letter queue
 */
interface FailedWebhook {
  /** Original request body */
  body: string
  /** Original request headers */
  headers: Record<string, string>
  /** Processing error */
  error: string
  /** Number of retry attempts made */
  attemptCount: number
  /** First failure timestamp */
  firstFailedAt: string
  /** Last failure timestamp */
  lastFailedAt: string
  /** Original webhook endpoint path */
  path: string
}

/**
 * Parsed webhook request with validated data
 */
interface ParsedWebhook<T = unknown> {
  /** Parsed payload */
  payload: T
  /** Extracted headers metadata */
  metadata: Record<string, string>
  /** Idempotency key if present */
  idempotencyKey?: string
  /** Request timestamp if present */
  timestamp?: number
  /** Raw request body for signature verification */
  rawBody: string
}

// =============================================================================
// TESTS: HMAC-SHA256 Signature Validation
// =============================================================================

describe('WebhookReceiver - HMAC-SHA256 Signature Validation', () => {
  it('should export WebhookReceiver class', async () => {
    // RED: This test should fail because the module doesn't exist
    const { WebhookReceiver } = await import('../webhook-receiver')

    expect(WebhookReceiver).toBeDefined()
    expect(typeof WebhookReceiver).toBe('function')
  })

  it('should validate correct SHA256 signature', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'webhook-secret-sha256'
    const body = JSON.stringify({ event: 'order.created', data: { id: 123 } })

    const receiver = new WebhookReceiver({ secrets: [secret], algorithm: 'sha256' })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(true)
    expect(result.matchedSecretIndex).toBe(0)
  })

  it('should reject invalid SHA256 signature', async () => {
    // RED: This test should fail
    const { WebhookReceiver } = await import('../webhook-receiver')

    const receiver = new WebhookReceiver({
      secrets: ['correct-secret'],
      algorithm: 'sha256',
    })

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': 'sha256=invalid-signature-here',
      },
      body: JSON.stringify({ test: true }),
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/signature/i)
  })

  it('should reject missing signature header', async () => {
    // RED: This test should fail
    const { WebhookReceiver } = await import('../webhook-receiver')

    const receiver = new WebhookReceiver({ secrets: ['secret'] })

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/missing.*signature/i)
  })

  it('should use constant-time comparison to prevent timing attacks', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'timing-attack-test-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({ secrets: [secret] })

    const validSignature = await createHmacSignature(body, secret, 'sha256')
    // Create invalid signature of same length
    const invalidSignature = validSignature.replace(/./g, (char, i) =>
      i < 10 ? ((parseInt(char, 16) + 1) % 16).toString(16) : char
    )

    const iterations = 100
    const validTimes: number[] = []
    const invalidTimes: number[] = []

    for (let i = 0; i < iterations; i++) {
      const validRequest = new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${validSignature}`,
        },
        body,
      })

      const invalidRequest = new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${invalidSignature}`,
        },
        body,
      })

      const validStart = performance.now()
      await receiver.validateSignature(validRequest.clone())
      validTimes.push(performance.now() - validStart)

      const invalidStart = performance.now()
      await receiver.validateSignature(invalidRequest.clone())
      invalidTimes.push(performance.now() - invalidStart)
    }

    const validAvg = validTimes.reduce((a, b) => a + b, 0) / iterations
    const invalidAvg = invalidTimes.reduce((a, b) => a + b, 0) / iterations

    // Times should be within 15% for timing-safe comparison
    const timeDiffRatio = Math.abs(validAvg - invalidAvg) / Math.max(validAvg, invalidAvg)
    expect(timeDiffRatio).toBeLessThan(0.15)
  })

  it('should support custom signature header name', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'custom-header-secret'
    const body = JSON.stringify({ test: true })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'X-Custom-Signature',
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(true)
  })

  it('should validate signature without algorithm prefix', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'no-prefix-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature, // No sha256= prefix
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(true)
  })
})

// =============================================================================
// TESTS: HMAC-SHA1 Signature Validation (Legacy)
// =============================================================================

describe('WebhookReceiver - HMAC-SHA1 Signature Validation (Legacy)', () => {
  it('should validate correct SHA1 signature', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'legacy-sha1-secret'
    const body = JSON.stringify({ event: 'legacy.event' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      algorithm: 'sha1',
      signatureHeader: 'X-Hub-Signature',
    })

    const signature = await createHmacSignature(body, secret, 'sha1')

    const request = new Request('https://example.com/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha1=${signature}`,
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(true)
  })

  it('should reject SHA1 when SHA256 is required', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'strict-algo-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      algorithm: 'sha256', // Requires SHA256
    })

    // Create SHA1 signature instead
    const sha1Signature = await createHmacSignature(body, secret, 'sha1')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha1=${sha1Signature}`,
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/algorithm/i)
  })

  it('should handle GitHub-style signature format', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'github-webhook-secret'
    const body = JSON.stringify({
      action: 'opened',
      pull_request: { number: 1 },
    })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      algorithm: 'sha1',
      signatureHeader: 'X-Hub-Signature',
    })

    const signature = await createHmacSignature(body, secret, 'sha1')

    const request = new Request('https://example.com/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha1=${signature}`,
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': 'delivery-uuid-123',
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(true)
  })

  it('should warn about legacy SHA1 usage', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const secret = 'sha1-warning-secret'
    const body = JSON.stringify({ test: true })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      algorithm: 'sha1',
      warnOnLegacyAlgorithm: true, // Enable warning for legacy algorithms
    })

    const signature = await createHmacSignature(body, secret, 'sha1')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha1=${signature}`,
      },
      body,
    })

    await receiver.validateSignature(request)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/sha1.*deprecated|legacy/i))

    warnSpy.mockRestore()
  })
})

// =============================================================================
// TESTS: Timestamp-based Replay Protection
// =============================================================================

describe('WebhookReceiver - Timestamp-based Replay Protection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should accept request with valid timestamp', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'timestamp-secret'
    const now = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ event: 'test', timestamp: now })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      timestampHeader: 'X-Webhook-Timestamp',
      timestampToleranceSeconds: 300, // 5 minutes
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': String(now),
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.timestampValid).toBe(true)
  })

  it('should reject request with old timestamp (replay attack)', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'replay-protection-secret'
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600 // 10 minutes ago
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      timestampHeader: 'X-Webhook-Timestamp',
      timestampToleranceSeconds: 300, // 5 minutes tolerance
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': String(oldTimestamp),
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timestamp.*expired|old|replay/i)
  })

  it('should reject request with future timestamp', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'future-timestamp-secret'
    const futureTimestamp = Math.floor(Date.now() / 1000) + 600 // 10 minutes in future
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      timestampHeader: 'X-Webhook-Timestamp',
      timestampToleranceSeconds: 300,
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': String(futureTimestamp),
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timestamp.*future/i)
  })

  it('should include timestamp in signature validation (Stripe-style)', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createStripeSignature } = await import('../webhook-receiver')

    const secret = 'stripe-timestamp-secret'
    const timestamp = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ type: 'payment_intent.succeeded' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'Stripe-Signature',
      signatureFormat: 'stripe', // t=timestamp,v1=signature format
    })

    const signaturePayload = `${timestamp}.${body}`
    const signature = await createStripeSignature(body, secret, timestamp)

    const request = new Request('https://example.com/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signature, // t=123456,v1=abc...
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
  })

  it('should reject timestamp-tampered request (signature mismatch)', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createStripeSignature } = await import('../webhook-receiver')

    const secret = 'tamper-detection-secret'
    const originalTimestamp = Math.floor(Date.now() / 1000) - 600 // Original: 10 min ago
    const tamperedTimestamp = Math.floor(Date.now() / 1000) // Tampered: now
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'Stripe-Signature',
      signatureFormat: 'stripe',
    })

    // Signature was computed with original timestamp
    const signature = await createStripeSignature(body, secret, originalTimestamp)
    // But header contains tampered timestamp
    const tamperedSignatureHeader = signature.replace(
      `t=${originalTimestamp}`,
      `t=${tamperedTimestamp}`
    )

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': tamperedSignatureHeader,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/signature|tamper/i)
  })
})

// =============================================================================
// TESTS: Idempotency Key Deduplication
// =============================================================================

describe('WebhookReceiver - Idempotency Key Deduplication', () => {
  it('should accept first request with idempotency key', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'idempotency-secret'
    const body = JSON.stringify({ event: 'order.created', orderId: 123 })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      enableIdempotency: true,
      idempotencyHeader: 'X-Idempotency-Key',
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Idempotency-Key': 'unique-key-12345',
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.isDuplicate).toBe(false)
  })

  it('should detect duplicate request with same idempotency key', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'duplicate-detection-secret'
    const body = JSON.stringify({ event: 'test' })
    const idempotencyKey = 'duplicate-key-67890'

    const receiver = new WebhookReceiver({
      secrets: [secret],
      enableIdempotency: true,
      idempotencyHeader: 'X-Idempotency-Key',
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const createRequest = () =>
      new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Idempotency-Key': idempotencyKey,
        },
        body,
      })

    // First request
    const result1 = await receiver.handle(createRequest())
    expect(result1.success).toBe(true)
    expect(result1.isDuplicate).toBe(false)

    // Second request with same key
    const result2 = await receiver.handle(createRequest())
    expect(result2.success).toBe(true) // Still succeeds but marked as duplicate
    expect(result2.isDuplicate).toBe(true)
  })

  it('should expire idempotency keys after TTL', async () => {
    // RED: This test should fail
    vi.useFakeTimers()

    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'ttl-expiry-secret'
    const body = JSON.stringify({ event: 'test' })
    const idempotencyKey = 'expiring-key-abc'

    const receiver = new WebhookReceiver({
      secrets: [secret],
      enableIdempotency: true,
      idempotencyHeader: 'X-Idempotency-Key',
      idempotencyTTLMs: 60000, // 1 minute TTL
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const createRequest = () =>
      new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Idempotency-Key': idempotencyKey,
        },
        body,
      })

    // First request
    const result1 = await receiver.handle(createRequest())
    expect(result1.isDuplicate).toBe(false)

    // Same key immediately - should be duplicate
    const result2 = await receiver.handle(createRequest())
    expect(result2.isDuplicate).toBe(true)

    // Advance time past TTL
    vi.advanceTimersByTime(61000)

    // Same key after TTL expired - should NOT be duplicate
    const result3 = await receiver.handle(createRequest())
    expect(result3.isDuplicate).toBe(false)

    vi.useRealTimers()
  })

  it('should handle missing idempotency key when enabled', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'missing-key-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      enableIdempotency: true,
      idempotencyHeader: 'X-Idempotency-Key',
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        // No X-Idempotency-Key header
      },
      body,
    })

    // Should still process without idempotency checking
    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.isDuplicate).toBeUndefined() // No idempotency key to check
  })

  it('should provide idempotency statistics', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'stats-secret'
    const receiver = new WebhookReceiver({
      secrets: [secret],
      enableIdempotency: true,
      idempotencyHeader: 'X-Idempotency-Key',
    })

    const createRequest = async (key: string) => {
      const body = JSON.stringify({ key })
      const signature = await createHmacSignature(body, secret, 'sha256')
      return new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Idempotency-Key': key,
        },
        body,
      })
    }

    // Process multiple requests
    await receiver.handle(await createRequest('key-1'))
    await receiver.handle(await createRequest('key-2'))
    await receiver.handle(await createRequest('key-1')) // Duplicate
    await receiver.handle(await createRequest('key-3'))
    await receiver.handle(await createRequest('key-2')) // Duplicate

    const stats = receiver.getIdempotencyStats()

    expect(stats.storedKeys).toBe(3)
    expect(stats.duplicatesDetected).toBe(2)
  })
})

// =============================================================================
// TESTS: Request Body Parsing
// =============================================================================

describe('WebhookReceiver - Request Body Parsing', () => {
  it('should parse JSON request body', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'json-parsing-secret'
    const payload = {
      event: 'user.created',
      data: { id: 1, name: 'John', email: 'john@example.com' },
    }
    const body = JSON.stringify(payload)

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.payload).toEqual(payload)
  })

  it('should parse form-urlencoded request body', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'form-parsing-secret'
    const body = 'event=form.submitted&name=John&email=john%40example.com&age=30'

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.payload).toEqual({
      event: 'form.submitted',
      name: 'John',
      email: 'john@example.com',
      age: '30',
    })
  })

  it('should reject body exceeding max size', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'size-limit-secret'
    const largePayload = { data: 'x'.repeat(2 * 1024 * 1024) } // 2MB
    const body = JSON.stringify(largePayload)

    const receiver = new WebhookReceiver({
      secrets: [secret],
      maxBodySizeBytes: 1024 * 1024, // 1MB limit
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/body.*size|too large/i)
  })

  it('should handle invalid JSON gracefully', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'invalid-json-secret'
    const body = '{ invalid json content'

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/json|parse/i)
  })

  it('should handle empty body', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'empty-body-secret'
    const body = ''

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handle(request)

    // Empty body with valid signature should succeed
    expect(result.success).toBe(true)
    expect(result.payload).toEqual({})
  })

  it('should preserve raw body for signature verification', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature, parseWebhook } = await import(
      '../webhook-receiver'
    )

    const secret = 'raw-body-secret'
    // JSON with specific whitespace that must be preserved
    const body = '{"event":"test",  "data":   {"id":1}}'

    const receiver = new WebhookReceiver({ secrets: [secret] })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const parsed = await parseWebhook(request.clone())

    // Raw body must match exactly for signature verification
    expect(parsed.rawBody).toBe(body)
  })
})

// =============================================================================
// TESTS: Header Extraction for Metadata
// =============================================================================

describe('WebhookReceiver - Header Extraction for Metadata', () => {
  it('should extract specified headers as metadata', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'metadata-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      metadataHeaders: ['X-Request-Id', 'X-Event-Type', 'X-Source'],
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Request-Id': 'req-abc-123',
        'X-Event-Type': 'order.created',
        'X-Source': 'shopify',
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.metadata).toEqual({
      'X-Request-Id': 'req-abc-123',
      'X-Event-Type': 'order.created',
      'X-Source': 'shopify',
    })
  })

  it('should handle missing metadata headers gracefully', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'missing-metadata-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      metadataHeaders: ['X-Request-Id', 'X-Missing-Header', 'X-Another-Missing'],
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Request-Id': 'present-id',
        // X-Missing-Header and X-Another-Missing are not present
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.metadata).toEqual({
      'X-Request-Id': 'present-id',
      // Missing headers should not be included
    })
    expect(result.metadata?.['X-Missing-Header']).toBeUndefined()
  })

  it('should extract case-insensitive headers', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'case-insensitive-secret'
    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      metadataHeaders: ['x-request-id', 'X-EVENT-TYPE'], // Different cases
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Request-ID': 'req-123', // Different case than config
        'x-event-type': 'customer.updated',
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(Object.keys(result.metadata!).length).toBe(2)
  })

  it('should extract GitHub-specific headers', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'github-metadata-secret'
    const body = JSON.stringify({
      action: 'opened',
      number: 1,
      pull_request: { title: 'Test PR' },
    })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      algorithm: 'sha256',
      signatureHeader: 'X-Hub-Signature-256',
      metadataHeaders: [
        'X-GitHub-Event',
        'X-GitHub-Delivery',
        'X-GitHub-Hook-ID',
        'X-GitHub-Hook-Installation-Target-Type',
      ],
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${signature}`,
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': 'delivery-uuid-abc',
        'X-GitHub-Hook-ID': '12345',
        'X-GitHub-Hook-Installation-Target-Type': 'repository',
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.metadata).toEqual({
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'delivery-uuid-abc',
      'X-GitHub-Hook-ID': '12345',
      'X-GitHub-Hook-Installation-Target-Type': 'repository',
    })
  })
})

// =============================================================================
// TESTS: Retry Handling with Exponential Backoff
// =============================================================================

describe('WebhookReceiver - Retry Handling with Exponential Backoff', () => {
  it('should export calculateBackoffDelay function', async () => {
    // RED: This test should fail
    const { calculateBackoffDelay } = await import('../webhook-receiver')

    expect(calculateBackoffDelay).toBeDefined()
    expect(typeof calculateBackoffDelay).toBe('function')
  })

  it('should calculate exponential backoff delays', async () => {
    // RED: This test should fail
    const { calculateBackoffDelay } = await import('../webhook-receiver')

    const config: RetryConfig = {
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitter: false,
    }

    expect(calculateBackoffDelay(1, config)).toBe(1000) // 1st attempt: 1s
    expect(calculateBackoffDelay(2, config)).toBe(2000) // 2nd attempt: 2s
    expect(calculateBackoffDelay(3, config)).toBe(4000) // 3rd attempt: 4s
    expect(calculateBackoffDelay(4, config)).toBe(8000) // 4th attempt: 8s
    expect(calculateBackoffDelay(5, config)).toBe(16000) // 5th attempt: 16s
  })

  it('should cap delay at maxDelayMs', async () => {
    // RED: This test should fail
    const { calculateBackoffDelay } = await import('../webhook-receiver')

    const config: RetryConfig = {
      maxAttempts: 10,
      initialDelayMs: 10000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: false,
    }

    // 10000 * 2^4 = 160000, but capped at 30000
    expect(calculateBackoffDelay(5, config)).toBe(30000)
  })

  it('should add jitter when enabled', async () => {
    // RED: This test should fail
    const { calculateBackoffDelay } = await import('../webhook-receiver')

    const config: RetryConfig = {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitter: true,
    }

    // With jitter, delays should vary
    const delays = new Set<number>()
    for (let i = 0; i < 20; i++) {
      delays.add(calculateBackoffDelay(1, config))
    }

    // Should have multiple different values due to jitter
    expect(delays.size).toBeGreaterThan(1)

    // All values should be within reasonable range (base * 0.5 to base * 1.5)
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(500) // 1000 * 0.5
      expect(delay).toBeLessThanOrEqual(1500) // 1000 * 1.5
    }
  })

  it('should track retry attempts', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const processingAttempts: number[] = []

    const receiver = new WebhookReceiver({
      secrets: ['retry-tracking-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
      },
    })

    // Simulate processing that tracks attempt numbers
    receiver.onProcess(async (webhook, attemptNumber) => {
      processingAttempts.push(attemptNumber)
      if (attemptNumber < 3) {
        throw new Error('Simulated failure')
      }
      return { processed: true }
    })

    const secret = 'retry-tracking-secret'
    const body = JSON.stringify({ event: 'test' })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    await receiver.handleWithRetry(request)

    expect(processingAttempts).toEqual([1, 2, 3])
  })

  it('should provide retry metadata in result', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const receiver = new WebhookReceiver({
      secrets: ['retry-metadata-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 1000,
        backoffMultiplier: 2,
        jitter: false,
      },
    })

    let failCount = 0
    receiver.onProcess(async () => {
      failCount++
      if (failCount < 2) {
        throw new Error('Temporary failure')
      }
      return { success: true }
    })

    const secret = 'retry-metadata-secret'
    const body = JSON.stringify({ event: 'test' })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handleWithRetry(request)

    expect(result.success).toBe(true)
    expect(result.retryInfo).toBeDefined()
    expect(result.retryInfo?.attemptCount).toBe(2)
    expect(result.retryInfo?.wasRetried).toBe(true)
  })
})

// =============================================================================
// TESTS: Dead Letter Queue for Failed Webhooks
// =============================================================================

describe('WebhookReceiver - Dead Letter Queue for Failed Webhooks', () => {
  it('should send to DLQ after max retries exceeded', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const dlqMessages: FailedWebhook[] = []

    const receiver = new WebhookReceiver({
      secrets: ['dlq-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      },
      dlqHandler: async (failedWebhook) => {
        dlqMessages.push(failedWebhook)
      },
    })

    receiver.onProcess(async () => {
      throw new Error('Persistent failure')
    })

    const secret = 'dlq-secret'
    const body = JSON.stringify({ event: 'failing.event', id: 123 })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Request-Id': 'failing-request-123',
      },
      body,
    })

    const result = await receiver.handleWithRetry(request)

    expect(result.success).toBe(false)
    expect(result.sentToDLQ).toBe(true)

    expect(dlqMessages).toHaveLength(1)
    expect(dlqMessages[0].body).toBe(body)
    expect(dlqMessages[0].attemptCount).toBe(3)
    expect(dlqMessages[0].error).toMatch(/persistent failure/i)
  })

  it('should include all metadata in DLQ message', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    let dlqMessage: FailedWebhook | null = null

    const receiver = new WebhookReceiver({
      secrets: ['dlq-metadata-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 1, // Fail immediately after 1 attempt
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      },
      dlqHandler: async (webhook) => {
        dlqMessage = webhook
      },
    })

    receiver.onProcess(async () => {
      throw new Error('DLQ metadata test failure')
    })

    const secret = 'dlq-metadata-secret'
    const body = JSON.stringify({ event: 'test' })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks/test-path', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Request-Id': 'dlq-test-req-id',
        'X-Event-Type': 'test.event',
      },
      body,
    })

    await receiver.handleWithRetry(request)

    expect(dlqMessage).not.toBeNull()
    expect(dlqMessage!.body).toBe(body)
    expect(dlqMessage!.path).toBe('/webhooks/test-path')
    expect(dlqMessage!.headers['X-Request-Id']).toBe('dlq-test-req-id')
    expect(dlqMessage!.headers['X-Event-Type']).toBe('test.event')
    expect(dlqMessage!.firstFailedAt).toBeDefined()
    expect(dlqMessage!.lastFailedAt).toBeDefined()
  })

  it('should allow reprocessing from DLQ', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature, reprocessFromDLQ } = await import(
      '../webhook-receiver'
    )

    const processedPayloads: unknown[] = []

    const receiver = new WebhookReceiver({
      secrets: ['reprocess-secret'],
    })

    receiver.onProcess(async (webhook) => {
      processedPayloads.push(webhook.payload)
      return { reprocessed: true }
    })

    const body = JSON.stringify({ event: 'reprocess.test', id: 456 })

    const dlqMessage: FailedWebhook = {
      body,
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': 'sha256=abc', // Original signature
        'X-Request-Id': 'dlq-reprocess-id',
      },
      error: 'Original processing failure',
      attemptCount: 3,
      firstFailedAt: '2024-01-15T10:00:00Z',
      lastFailedAt: '2024-01-15T10:01:30Z',
      path: '/webhooks',
    }

    // Reprocess without signature validation (trusted DLQ source)
    const result = await reprocessFromDLQ(receiver, dlqMessage, { skipSignatureValidation: true })

    expect(result.success).toBe(true)
    expect(processedPayloads).toHaveLength(1)
    expect(processedPayloads[0]).toEqual({ event: 'reprocess.test', id: 456 })
  })

  it('should export DLQ statistics', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const receiver = new WebhookReceiver({
      secrets: ['dlq-stats-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 1,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      },
      dlqHandler: async () => {
        /* no-op */
      },
    })

    receiver.onProcess(async () => {
      throw new Error('Failure')
    })

    const secret = 'dlq-stats-secret'
    const createFailingRequest = async () => {
      const body = JSON.stringify({ event: 'fail' })
      const signature = await createHmacSignature(body, secret, 'sha256')
      return new Request('https://example.com/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
        },
        body,
      })
    }

    await receiver.handleWithRetry(await createFailingRequest())
    await receiver.handleWithRetry(await createFailingRequest())
    await receiver.handleWithRetry(await createFailingRequest())

    const stats = receiver.getDLQStats()

    expect(stats.totalSentToDLQ).toBe(3)
    expect(stats.lastSentAt).toBeDefined()
  })

  it('should handle DLQ handler errors gracefully', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const receiver = new WebhookReceiver({
      secrets: ['dlq-error-secret'],
      enableRetryHandling: true,
      retryConfig: {
        maxAttempts: 1,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      },
      dlqHandler: async () => {
        throw new Error('DLQ storage failure')
      },
    })

    receiver.onProcess(async () => {
      throw new Error('Processing failure')
    })

    const secret = 'dlq-error-secret'
    const body = JSON.stringify({ event: 'test' })
    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
      },
      body,
    })

    const result = await receiver.handleWithRetry(request)

    // Should indicate failure and DLQ error
    expect(result.success).toBe(false)
    expect(result.dlqError).toMatch(/DLQ storage failure/i)

    errorSpy.mockRestore()
  })
})

// =============================================================================
// TESTS: Secret Rotation Support
// =============================================================================

describe('WebhookReceiver - Secret Rotation Support', () => {
  it('should validate signature with any of multiple secrets', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const oldSecret = 'old-rotation-secret'
    const newSecret = 'new-rotation-secret'
    const body = JSON.stringify({ event: 'rotation.test' })

    const receiver = new WebhookReceiver({
      secrets: [newSecret, oldSecret], // New secret first, old secret for rotation
    })

    // Request signed with old secret
    const oldSignature = await createHmacSignature(body, oldSecret, 'sha256')
    const oldRequest = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${oldSignature}`,
      },
      body,
    })

    const oldResult = await receiver.validateSignature(oldRequest)
    expect(oldResult.valid).toBe(true)
    expect(oldResult.matchedSecretIndex).toBe(1) // Matched old secret at index 1

    // Request signed with new secret
    const newSignature = await createHmacSignature(body, newSecret, 'sha256')
    const newRequest = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${newSignature}`,
      },
      body,
    })

    const newResult = await receiver.validateSignature(newRequest)
    expect(newResult.valid).toBe(true)
    expect(newResult.matchedSecretIndex).toBe(0) // Matched new secret at index 0
  })

  it('should reject request not matching any secret', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const body = JSON.stringify({ event: 'test' })

    const receiver = new WebhookReceiver({
      secrets: ['secret-1', 'secret-2', 'secret-3'],
    })

    // Signed with a secret not in the list
    const wrongSignature = await createHmacSignature(body, 'wrong-secret', 'sha256')
    const request = new Request('https://example.com/webhooks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${wrongSignature}`,
      },
      body,
    })

    const result = await receiver.validateSignature(request)

    expect(result.valid).toBe(false)
    expect(result.matchedSecretIndex).toBeUndefined()
  })
})

// =============================================================================
// TESTS: Provider-specific Formats
// =============================================================================

describe('WebhookReceiver - Provider-specific Formats', () => {
  it('should handle Stripe signature format (t=timestamp,v1=signature)', async () => {
    // RED: This test should fail
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))

    const { WebhookReceiver, createStripeSignature } = await import('../webhook-receiver')

    const secret = 'whsec_stripe_secret_key'
    const body = JSON.stringify({ type: 'checkout.session.completed', id: 'cs_test_123' })
    const timestamp = Math.floor(Date.now() / 1000)

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'Stripe-Signature',
      signatureFormat: 'stripe',
      timestampToleranceSeconds: 300,
    })

    const signatureHeader = await createStripeSignature(body, secret, timestamp)

    const request = new Request('https://example.com/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signatureHeader,
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.payload).toEqual({ type: 'checkout.session.completed', id: 'cs_test_123' })

    vi.useRealTimers()
  })

  it('should handle Slack signature format (v0=signature with separate timestamp)', async () => {
    // RED: This test should fail
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))

    const { WebhookReceiver, createSlackSignature } = await import('../webhook-receiver')

    const secret = 'slack_signing_secret'
    const body = 'token=xxx&team_id=T123&event_id=Ev123'
    const timestamp = Math.floor(Date.now() / 1000)

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'X-Slack-Signature',
      timestampHeader: 'X-Slack-Request-Timestamp',
      signatureFormat: 'slack',
      timestampToleranceSeconds: 300,
    })

    const signature = await createSlackSignature(body, secret, timestamp)

    const request = new Request('https://example.com/webhooks/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Slack-Signature': signature,
        'X-Slack-Request-Timestamp': String(timestamp),
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)

    vi.useRealTimers()
  })

  it('should handle GitHub signature format (sha256=signature)', async () => {
    // RED: This test should fail
    const { WebhookReceiver, createHmacSignature } = await import('../webhook-receiver')

    const secret = 'github_webhook_secret'
    const body = JSON.stringify({
      action: 'opened',
      pull_request: { number: 42, title: 'Test PR' },
    })

    const receiver = new WebhookReceiver({
      secrets: [secret],
      signatureHeader: 'X-Hub-Signature-256',
      signatureFormat: 'github',
      metadataHeaders: ['X-GitHub-Event', 'X-GitHub-Delivery'],
    })

    const signature = await createHmacSignature(body, secret, 'sha256')

    const request = new Request('https://example.com/webhooks/github', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${signature}`,
        'X-GitHub-Event': 'pull_request',
        'X-GitHub-Delivery': 'delivery-uuid-123',
      },
      body,
    })

    const result = await receiver.handle(request)

    expect(result.success).toBe(true)
    expect(result.metadata?.['X-GitHub-Event']).toBe('pull_request')
    expect(result.metadata?.['X-GitHub-Delivery']).toBe('delivery-uuid-123')
  })
})

// =============================================================================
// TESTS: Factory Functions and Utilities
// =============================================================================

describe('WebhookReceiver - Factory Functions and Utilities', () => {
  it('should export createWebhookReceiver factory function', async () => {
    // RED: This test should fail
    const { createWebhookReceiver } = await import('../webhook-receiver')

    expect(createWebhookReceiver).toBeDefined()
    expect(typeof createWebhookReceiver).toBe('function')

    const receiver = createWebhookReceiver({ secrets: ['test-secret'] })
    expect(receiver).toBeDefined()
  })

  it('should export createHmacSignature utility', async () => {
    // RED: This test should fail
    const { createHmacSignature } = await import('../webhook-receiver')

    expect(createHmacSignature).toBeDefined()
    expect(typeof createHmacSignature).toBe('function')

    const signature = await createHmacSignature('test payload', 'secret', 'sha256')

    expect(typeof signature).toBe('string')
    expect(signature).toMatch(/^[a-f0-9]{64}$/) // SHA256 produces 64 hex chars
  })

  it('should export verifyHmacSignature utility', async () => {
    // RED: This test should fail
    const { createHmacSignature, verifyHmacSignature } = await import('../webhook-receiver')

    expect(verifyHmacSignature).toBeDefined()

    const payload = 'test payload'
    const secret = 'secret'
    const signature = await createHmacSignature(payload, secret, 'sha256')

    expect(await verifyHmacSignature(payload, secret, signature, 'sha256')).toBe(true)
    expect(await verifyHmacSignature(payload, secret, 'wrong-signature', 'sha256')).toBe(false)
    expect(await verifyHmacSignature('wrong payload', secret, signature, 'sha256')).toBe(false)
  })

  it('should export DEFAULT_RETRY_CONFIG', async () => {
    // RED: This test should fail
    const { DEFAULT_RETRY_CONFIG } = await import('../webhook-receiver')

    expect(DEFAULT_RETRY_CONFIG).toBeDefined()
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3)
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000)
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(300000)
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2)
    expect(DEFAULT_RETRY_CONFIG.jitter).toBe(true)
  })
})
