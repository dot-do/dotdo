import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import * as crypto from 'node:crypto'

/**
 * Webhooks Middleware Tests
 *
 * These tests verify the webhooks middleware for handling incoming webhooks
 * from third-party services (GitHub, Stripe, etc.).
 *
 * Tests are expected to FAIL until the middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/webhooks.ts
 * - Support routing by webhook source (github, stripe, etc.)
 * - Verify webhook signatures per provider
 * - Route to handlers by event type (github:push, stripe:invoice.paid)
 * - Support provider configuration from integrations.do or env vars
 */

// Import the middleware (will fail until implemented)
// @ts-expect-error - Middleware not yet implemented
import { webhooks, type WebhooksConfig, type WebhookHandler } from '../../middleware/webhooks'

// ============================================================================
// Test Types
// ============================================================================

interface WebhookPayload {
  action?: string
  ref?: string
  type?: string
  data?: {
    object?: Record<string, unknown>
  }
  [key: string]: unknown
}

interface WebhookResponse {
  received?: boolean
  error?: string
  eventType?: string
  message?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a GitHub webhook signature (sha256)
 */
function generateGitHubSignature(payload: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

/**
 * Generate a Stripe webhook signature
 * Stripe uses timestamp.signature format
 */
function generateStripeSignature(payload: string, secret: string, timestamp?: number): string {
  const ts = timestamp || Math.floor(Date.now() / 1000)
  const signedPayload = `${ts}.${payload}`
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(signedPayload)
  const signature = hmac.digest('hex')
  return `t=${ts},v1=${signature}`
}

/**
 * Create a test app with webhooks middleware
 */
function createTestApp(config?: WebhooksConfig): Hono {
  const app = new Hono()
  app.use('/api/webhooks/*', webhooks(config))
  return app
}

/**
 * Make a webhook request to the test app
 */
async function webhookRequest(
  app: Hono,
  source: string,
  options: {
    body: unknown
    headers?: Record<string, string>
    method?: string
  }
): Promise<Response> {
  const body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
  return app.request(`/api/webhooks/${source}`, {
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body,
  })
}

// ============================================================================
// Test Constants
// ============================================================================

const TEST_GITHUB_SECRET = 'test-github-webhook-secret'
const TEST_STRIPE_SECRET = 'whsec_test_stripe_secret_key'

const GITHUB_PUSH_PAYLOAD: WebhookPayload = {
  ref: 'refs/heads/main',
  before: 'abc123',
  after: 'def456',
  repository: {
    full_name: 'owner/repo',
  },
  pusher: {
    name: 'testuser',
    email: 'test@example.com',
  },
}

const GITHUB_PR_PAYLOAD: WebhookPayload = {
  action: 'opened',
  number: 123,
  pull_request: {
    title: 'Test PR',
    body: 'Test description',
    head: { ref: 'feature-branch' },
    base: { ref: 'main' },
  },
}

const STRIPE_INVOICE_PAID_PAYLOAD = {
  id: 'evt_test123',
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_test456',
      customer: 'cus_test789',
      amount_paid: 1000,
      currency: 'usd',
    },
  },
}

const STRIPE_CUSTOMER_CREATED_PAYLOAD = {
  id: 'evt_test456',
  type: 'customer.created',
  data: {
    object: {
      id: 'cus_newcustomer',
      email: 'new@example.com',
    },
  },
}

// ============================================================================
// 1. Routing Tests
// ============================================================================

describe('Webhooks Middleware - Routing', () => {
  let app: Hono

  beforeEach(() => {
    app = createTestApp({
      handlers: {},
    })
  })

  describe('POST /api/webhooks/:source routes correctly', () => {
    it('routes POST /api/webhooks/github to github handler', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async () => ({ handled: true }),
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      // Should accept the webhook (200 or 202)
      expect([200, 202]).toContain(res.status)
    })

    it('routes POST /api/webhooks/stripe to stripe handler', async () => {
      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:invoice.paid': async () => ({ handled: true }),
        },
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('accepts POST method only', async () => {
      const res = await app.request('/api/webhooks/github', {
        method: 'GET',
      })

      expect(res.status).toBe(405)
    })

    it('rejects PUT method', async () => {
      const res = await app.request('/api/webhooks/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(405)
    })

    it('rejects DELETE method', async () => {
      const res = await app.request('/api/webhooks/github', {
        method: 'DELETE',
      })

      expect(res.status).toBe(405)
    })
  })

  describe('Unknown provider returns 404', () => {
    it('returns 404 for unknown webhook provider', async () => {
      const res = await webhookRequest(app, 'unknown-provider', {
        body: { test: true },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as WebhookResponse
      expect(body.error).toBeDefined()
    })

    it('returns 404 for empty provider name', async () => {
      const res = await app.request('/api/webhooks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      })

      expect(res.status).toBe(404)
    })

    it('returns 404 for provider with invalid characters', async () => {
      const res = await webhookRequest(app, '../../../etc/passwd', {
        body: { test: true },
      })

      expect(res.status).toBe(404)
    })

    it('returns 404 message indicating unknown provider', async () => {
      const res = await webhookRequest(app, 'nonexistent', {
        body: { test: true },
      })

      expect(res.status).toBe(404)
      const body = (await res.json()) as WebhookResponse
      expect(body.error?.toLowerCase()).toMatch(/provider|not found|unknown/)
    })
  })
})

// ============================================================================
// 2. Signature Verification Tests
// ============================================================================

describe('Webhooks Middleware - Signature Verification', () => {
  describe('GitHub webhook signature verification (sha256)', () => {
    it('accepts valid GitHub sha256 signature', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async () => ({ success: true }),
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('verifies signature using X-Hub-Signature-256 header', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      // Valid signature should not return 401
      expect(res.status).not.toBe(401)
    })

    it('supports sha256 algorithm prefix in signature', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      // Signature should start with sha256=
      expect(signature).toMatch(/^sha256=/)

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).not.toBe(401)
    })

    it('uses timing-safe comparison for signatures', async () => {
      // This test verifies the implementation uses constant-time comparison
      // to prevent timing attacks. We can't directly test timing, but we
      // ensure invalid signatures are rejected properly.
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const validSignature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)
      const almostValidSignature = validSignature.slice(0, -1) + 'X'

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': almostValidSignature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Stripe webhook signature verification', () => {
    it('accepts valid Stripe signature', async () => {
      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:invoice.paid': async () => ({ success: true }),
        },
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect([200, 202]).toContain(res.status)
    })

    it('verifies signature using Stripe-Signature header', async () => {
      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(res.status).not.toBe(401)
    })

    it('validates timestamp in Stripe signature is recent', async () => {
      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      // Use an old timestamp (1 hour ago)
      const oldTimestamp = Math.floor(Date.now() / 1000) - 3600
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET, oldTimestamp)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET, timestampTolerance: 300 },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      // Old timestamp should be rejected
      expect(res.status).toBe(401)
    })

    it('parses Stripe signature format correctly (t=timestamp,v1=signature)', async () => {
      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const timestamp = Math.floor(Date.now() / 1000)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET, timestamp)

      // Verify signature format
      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]+$/)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(res.status).not.toBe(401)
    })
  })

  describe('Invalid signature returns 401', () => {
    it('returns 401 for invalid GitHub signature', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': 'sha256=invalid_signature_here',
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for invalid Stripe signature', async () => {
      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': 't=1234567890,v1=invalid_signature',
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for tampered payload with valid-looking signature', async () => {
      const originalPayload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(originalPayload, TEST_GITHUB_SECRET)

      // Tamper with the payload
      const tamperedPayload = { ...GITHUB_PUSH_PAYLOAD, ref: 'refs/heads/hacked' }

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: tamperedPayload,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 error body with appropriate message', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': 'sha256=wrong',
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
      const body = (await res.json()) as WebhookResponse
      expect(body.error?.toLowerCase()).toMatch(/signature|invalid|unauthorized/)
    })

    it('returns 401 for signature with wrong algorithm', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      // Use sha1 instead of sha256
      const hmac = crypto.createHmac('sha1', TEST_GITHUB_SECRET)
      hmac.update(payload)
      const wrongAlgoSignature = `sha1=${hmac.digest('hex')}`

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': wrongAlgoSignature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Missing signature header returns 401', () => {
    it('returns 401 for GitHub webhook without X-Hub-Signature-256', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-GitHub-Event': 'push',
          // Missing X-Hub-Signature-256
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for Stripe webhook without Stripe-Signature', async () => {
      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          // Missing Stripe-Signature
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for empty signature header', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': '',
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 message indicating missing signature', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
      const body = (await res.json()) as WebhookResponse
      expect(body.error?.toLowerCase()).toMatch(/signature|missing|required/)
    })
  })
})

// ============================================================================
// 3. Handler Routing Tests
// ============================================================================

describe('Webhooks Middleware - Handler Routing', () => {
  describe('Routes by event type (github:push, github:pull_request)', () => {
    it('routes github:push events to correct handler', async () => {
      const pushHandlerMock = vi.fn()

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': pushHandlerMock,
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(pushHandlerMock).toHaveBeenCalled()
    })

    it('routes github:pull_request events to correct handler', async () => {
      const prHandlerMock = vi.fn()

      const payload = JSON.stringify(GITHUB_PR_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:pull_request': prHandlerMock,
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PR_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'pull_request',
        },
      })

      expect(prHandlerMock).toHaveBeenCalled()
    })

    it('extracts event type from X-GitHub-Event header', async () => {
      const issueHandlerMock = vi.fn()
      const issuePayload = { action: 'opened', issue: { title: 'Test issue' } }

      const payload = JSON.stringify(issuePayload)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:issues': issueHandlerMock,
        },
      })

      await webhookRequest(app, 'github', {
        body: issuePayload,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'issues',
        },
      })

      expect(issueHandlerMock).toHaveBeenCalled()
    })

    it('does not call other handlers when event type matches', async () => {
      const pushHandler = vi.fn()
      const prHandler = vi.fn()

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': pushHandler,
          'github:pull_request': prHandler,
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(pushHandler).toHaveBeenCalled()
      expect(prHandler).not.toHaveBeenCalled()
    })
  })

  describe('Routes Stripe events (stripe:invoice.paid, stripe:customer.created)', () => {
    it('routes stripe:invoice.paid events to correct handler', async () => {
      const invoiceHandler = vi.fn()

      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:invoice.paid': invoiceHandler,
        },
      })

      await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(invoiceHandler).toHaveBeenCalled()
    })

    it('routes stripe:customer.created events to correct handler', async () => {
      const customerHandler = vi.fn()

      const payload = JSON.stringify(STRIPE_CUSTOMER_CREATED_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:customer.created': customerHandler,
        },
      })

      await webhookRequest(app, 'stripe', {
        body: STRIPE_CUSTOMER_CREATED_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(customerHandler).toHaveBeenCalled()
    })

    it('extracts event type from Stripe payload type field', async () => {
      const subscriptionHandler = vi.fn()
      const subscriptionPayload = {
        id: 'evt_sub',
        type: 'customer.subscription.created',
        data: { object: { id: 'sub_123' } },
      }

      const payload = JSON.stringify(subscriptionPayload)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:customer.subscription.created': subscriptionHandler,
        },
      })

      await webhookRequest(app, 'stripe', {
        body: subscriptionPayload,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(subscriptionHandler).toHaveBeenCalled()
    })
  })

  describe('Handler receives parsed payload', () => {
    it('handler receives parsed JSON payload', async () => {
      let receivedPayload: unknown = null

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (p) => {
            receivedPayload = p
          },
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(receivedPayload).toEqual(GITHUB_PUSH_PAYLOAD)
    })

    it('handler receives payload with correct structure', async () => {
      let receivedPayload: WebhookPayload | null = null

      const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

      const app = createTestApp({
        providers: {
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'stripe:invoice.paid': async (p) => {
            receivedPayload = p as WebhookPayload
          },
        },
      })

      await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': signature,
        },
      })

      expect(receivedPayload).not.toBeNull()
      expect(receivedPayload?.type).toBe('invoice.paid')
      expect(receivedPayload?.data?.object).toBeDefined()
    })

    it('handler does not receive raw string payload', async () => {
      let receivedPayload: unknown = null

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (p) => {
            receivedPayload = p
          },
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(typeof receivedPayload).toBe('object')
      expect(typeof receivedPayload).not.toBe('string')
    })
  })

  describe('Handler receives Hono context', () => {
    it('handler receives Hono context as second argument', async () => {
      let receivedContext: Context | null = null

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (_payload, c) => {
            receivedContext = c
          },
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(receivedContext).not.toBeNull()
    })

    it('context has access to request headers', async () => {
      let deliveryId: string | undefined

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (_payload, c) => {
            deliveryId = c.req.header('X-GitHub-Delivery')
          },
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'delivery-123',
        },
      })

      expect(deliveryId).toBe('delivery-123')
    })

    it('context has access to request method', async () => {
      let requestMethod: string | undefined

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (_payload, c) => {
            requestMethod = c.req.method
          },
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(requestMethod).toBe('POST')
    })

    it('handler can use context to set response', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async (_payload, c) => {
            return c.json({ custom: 'response' }, 201)
          },
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(201)
      const body = (await res.json()) as { custom: string }
      expect(body.custom).toBe('response')
    })
  })

  describe('Handler for unknown event types', () => {
    it('returns 200 for unhandled event types (no matching handler)', async () => {
      const payload = JSON.stringify({ action: 'created', comment: {} })
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          // Only push handler, no issue_comment handler
          'github:push': async () => ({ handled: true }),
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: { action: 'created', comment: {} },
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'issue_comment',
        },
      })

      // Should acknowledge receipt even without handler
      expect([200, 202]).toContain(res.status)
    })

    it('returns received: true for events without handler', async () => {
      const payload = JSON.stringify({ action: 'created' })
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await webhookRequest(app, 'github', {
        body: { action: 'created' },
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'star',
        },
      })

      const body = (await res.json()) as WebhookResponse
      expect(body.received).toBe(true)
    })
  })
})

// ============================================================================
// 4. Provider Configuration Tests
// ============================================================================

describe('Webhooks Middleware - Provider Configuration', () => {
  describe('Provider config from integrations.do', () => {
    it('fetches provider config from integrations.do service', async () => {
      // Mock integrations.do fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          github: {
            webhookSecret: TEST_GITHUB_SECRET,
          },
        }),
      })

      // The middleware should attempt to fetch config from integrations.do
      // This test verifies the integration pattern
      const app = createTestApp({
        configSource: 'integrations.do',
        // Provide mock fetch for testing
        fetch: mockFetch,
        handlers: {
          'github:push': async () => ({ handled: true }),
        },
      })

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      // Should have called integrations.do to fetch config
      expect(mockFetch).toHaveBeenCalled()
    })

    it('caches provider config from integrations.do', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          github: { webhookSecret: TEST_GITHUB_SECRET },
        }),
      })

      const app = createTestApp({
        configSource: 'integrations.do',
        fetch: mockFetch,
        handlers: {},
      })

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      // Make multiple requests
      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      // Should cache and not call fetch multiple times
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('handles integrations.do fetch failure gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))

      const app = createTestApp({
        configSource: 'integrations.do',
        fetch: mockFetch,
        // Fallback to env var config
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      // Should fall back to static config
      expect([200, 202]).toContain(res.status)
    })
  })

  describe('Fallback to env vars for secrets', () => {
    it('uses GITHUB_WEBHOOK_SECRET env var when provider config not set', async () => {
      // Simulate env var being set
      const originalEnv = process.env.GITHUB_WEBHOOK_SECRET
      process.env.GITHUB_WEBHOOK_SECRET = TEST_GITHUB_SECRET

      try {
        const app = createTestApp({
          // No providers config - should fall back to env
          handlers: {
            'github:push': async () => ({ handled: true }),
          },
        })

        const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
        const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

        const res = await webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': signature,
            'X-GitHub-Event': 'push',
          },
        })

        expect([200, 202]).toContain(res.status)
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GITHUB_WEBHOOK_SECRET
        } else {
          process.env.GITHUB_WEBHOOK_SECRET = originalEnv
        }
      }
    })

    it('uses STRIPE_WEBHOOK_SECRET env var when provider config not set', async () => {
      const originalEnv = process.env.STRIPE_WEBHOOK_SECRET
      process.env.STRIPE_WEBHOOK_SECRET = TEST_STRIPE_SECRET

      try {
        const app = createTestApp({
          handlers: {
            'stripe:invoice.paid': async () => ({ handled: true }),
          },
        })

        const payload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
        const signature = generateStripeSignature(payload, TEST_STRIPE_SECRET)

        const res = await webhookRequest(app, 'stripe', {
          body: STRIPE_INVOICE_PAID_PAYLOAD,
          headers: {
            'Stripe-Signature': signature,
          },
        })

        expect([200, 202]).toContain(res.status)
      } finally {
        if (originalEnv === undefined) {
          delete process.env.STRIPE_WEBHOOK_SECRET
        } else {
          process.env.STRIPE_WEBHOOK_SECRET = originalEnv
        }
      }
    })

    it('prefers explicit config over env vars', async () => {
      const differentSecret = 'different-explicit-secret'
      process.env.GITHUB_WEBHOOK_SECRET = TEST_GITHUB_SECRET

      try {
        const app = createTestApp({
          providers: {
            github: { secret: differentSecret },
          },
          handlers: {},
        })

        // Use the explicit secret, not env var
        const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
        const signatureWithExplicit = generateGitHubSignature(payload, differentSecret)
        const signatureWithEnv = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

        const resWithExplicit = await webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': signatureWithExplicit,
            'X-GitHub-Event': 'push',
          },
        })

        const resWithEnv = await webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': signatureWithEnv,
            'X-GitHub-Event': 'push',
          },
        })

        // Explicit config should work
        expect([200, 202]).toContain(resWithExplicit.status)
        // Env var secret should fail
        expect(resWithEnv.status).toBe(401)
      } finally {
        delete process.env.GITHUB_WEBHOOK_SECRET
      }
    })

    it('returns 401 when no secret available (env or config)', async () => {
      // Ensure env var is not set
      const originalEnv = process.env.GITHUB_WEBHOOK_SECRET
      delete process.env.GITHUB_WEBHOOK_SECRET

      try {
        const app = createTestApp({
          // No providers config, no env var
          handlers: {},
        })

        const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
        const signature = generateGitHubSignature(payload, 'any-secret')

        const res = await webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': signature,
            'X-GitHub-Event': 'push',
          },
        })

        expect(res.status).toBe(401)
      } finally {
        if (originalEnv) {
          process.env.GITHUB_WEBHOOK_SECRET = originalEnv
        }
      }
    })
  })

  describe('Multiple providers', () => {
    it('supports multiple providers with different secrets', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'github:push': async () => ({ handled: 'github' }),
          'stripe:invoice.paid': async () => ({ handled: 'stripe' }),
        },
      })

      const githubPayload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const githubSig = generateGitHubSignature(githubPayload, TEST_GITHUB_SECRET)

      const stripePayload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const stripeSig = generateStripeSignature(stripePayload, TEST_STRIPE_SECRET)

      const githubRes = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': githubSig,
          'X-GitHub-Event': 'push',
        },
      })

      const stripeRes = await webhookRequest(app, 'stripe', {
        body: STRIPE_INVOICE_PAID_PAYLOAD,
        headers: {
          'Stripe-Signature': stripeSig,
        },
      })

      expect([200, 202]).toContain(githubRes.status)
      expect([200, 202]).toContain(stripeRes.status)
    })

    it('isolates secrets between providers', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {},
      })

      // Try using Stripe secret for GitHub webhook - should fail
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const wrongSig = generateGitHubSignature(payload, TEST_STRIPE_SECRET)

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': wrongSig,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(401)
    })
  })
})

// ============================================================================
// 5. Edge Cases and Error Handling
// ============================================================================

describe('Webhooks Middleware - Edge Cases', () => {
  describe('Malformed requests', () => {
    it('handles malformed JSON body', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const malformedBody = '{ invalid json }'
      const signature = generateGitHubSignature(malformedBody, TEST_GITHUB_SECRET)

      const res = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
        body: malformedBody,
      })

      expect(res.status).toBe(400)
    })

    it('handles empty body', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const res = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': generateGitHubSignature('', TEST_GITHUB_SECRET),
          'X-GitHub-Event': 'push',
        },
        body: '',
      })

      expect(res.status).toBe(400)
    })

    it('handles missing Content-Type header', async () => {
      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {},
      })

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const res = await app.request('/api/webhooks/github', {
        method: 'POST',
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
        body: payload,
      })

      // Should still work or return 415 Unsupported Media Type
      expect([200, 202, 415]).toContain(res.status)
    })
  })

  describe('Handler errors', () => {
    it('returns 500 when handler throws', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async () => {
            throw new Error('Handler error')
          },
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(500)
    })

    it('does not leak error details in production', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async () => {
            throw new Error('Sensitive error details here')
          },
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as WebhookResponse
      expect(body.error).not.toContain('Sensitive')
    })

    it('handles async handler rejection', async () => {
      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': () => Promise.reject(new Error('Async rejection')),
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: GITHUB_PUSH_PAYLOAD,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect(res.status).toBe(500)
    })
  })

  describe('Concurrent webhooks', () => {
    it('handles concurrent webhooks from same provider', async () => {
      let callCount = 0
      const handlerMock = vi.fn(async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { count: callCount }
      })

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': handlerMock,
        },
      })

      const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const requests = Array.from({ length: 5 }, () =>
        webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': signature,
            'X-GitHub-Event': 'push',
          },
        })
      )

      const responses = await Promise.all(requests)

      expect(handlerMock).toHaveBeenCalledTimes(5)
      responses.forEach((res) => {
        expect([200, 202]).toContain(res.status)
      })
    })

    it('handles concurrent webhooks from different providers', async () => {
      const githubHandler = vi.fn()
      const stripeHandler = vi.fn()

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
          stripe: { secret: TEST_STRIPE_SECRET },
        },
        handlers: {
          'github:push': githubHandler,
          'stripe:invoice.paid': stripeHandler,
        },
      })

      const githubPayload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
      const githubSig = generateGitHubSignature(githubPayload, TEST_GITHUB_SECRET)

      const stripePayload = JSON.stringify(STRIPE_INVOICE_PAID_PAYLOAD)
      const stripeSig = generateStripeSignature(stripePayload, TEST_STRIPE_SECRET)

      const [githubRes, stripeRes] = await Promise.all([
        webhookRequest(app, 'github', {
          body: GITHUB_PUSH_PAYLOAD,
          headers: {
            'X-Hub-Signature-256': githubSig,
            'X-GitHub-Event': 'push',
          },
        }),
        webhookRequest(app, 'stripe', {
          body: STRIPE_INVOICE_PAID_PAYLOAD,
          headers: {
            'Stripe-Signature': stripeSig,
          },
        }),
      ])

      expect(githubHandler).toHaveBeenCalled()
      expect(stripeHandler).toHaveBeenCalled()
      expect([200, 202]).toContain(githubRes.status)
      expect([200, 202]).toContain(stripeRes.status)
    })
  })

  describe('Large payloads', () => {
    it('handles large webhook payloads', async () => {
      const largePayload = {
        ...GITHUB_PUSH_PAYLOAD,
        commits: Array.from({ length: 100 }, (_, i) => ({
          id: `commit-${i}`,
          message: 'a'.repeat(1000),
          timestamp: new Date().toISOString(),
        })),
      }

      const payload = JSON.stringify(largePayload)
      const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

      const app = createTestApp({
        providers: {
          github: { secret: TEST_GITHUB_SECRET },
        },
        handlers: {
          'github:push': async () => ({ handled: true }),
        },
      })

      const res = await webhookRequest(app, 'github', {
        body: largePayload,
        headers: {
          'X-Hub-Signature-256': signature,
          'X-GitHub-Event': 'push',
        },
      })

      expect([200, 202]).toContain(res.status)
    })
  })
})

// ============================================================================
// 6. Response Format Tests
// ============================================================================

describe('Webhooks Middleware - Response Format', () => {
  it('returns JSON response', async () => {
    const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
    const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

    const app = createTestApp({
      providers: {
        github: { secret: TEST_GITHUB_SECRET },
      },
      handlers: {},
    })

    const res = await webhookRequest(app, 'github', {
      body: GITHUB_PUSH_PAYLOAD,
      headers: {
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'push',
      },
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('includes received: true on successful webhook', async () => {
    const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
    const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

    const app = createTestApp({
      providers: {
        github: { secret: TEST_GITHUB_SECRET },
      },
      handlers: {},
    })

    const res = await webhookRequest(app, 'github', {
      body: GITHUB_PUSH_PAYLOAD,
      headers: {
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'push',
      },
    })

    const body = (await res.json()) as WebhookResponse
    expect(body.received).toBe(true)
  })

  it('includes event type in response', async () => {
    const payload = JSON.stringify(GITHUB_PUSH_PAYLOAD)
    const signature = generateGitHubSignature(payload, TEST_GITHUB_SECRET)

    const app = createTestApp({
      providers: {
        github: { secret: TEST_GITHUB_SECRET },
      },
      handlers: {},
    })

    const res = await webhookRequest(app, 'github', {
      body: GITHUB_PUSH_PAYLOAD,
      headers: {
        'X-Hub-Signature-256': signature,
        'X-GitHub-Event': 'push',
      },
    })

    const body = (await res.json()) as WebhookResponse
    expect(body.eventType).toBe('github:push')
  })
})
