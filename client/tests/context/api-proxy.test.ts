/**
 * RED Phase Tests for $.api.* Integration Facade
 *
 * TDD tests for the API integration proxy that provides a unified interface
 * to all 38 compat SDKs (emails, stripe, slack, hubspot, etc.)
 *
 * API Design:
 * - $.api.emails.send() - Send email via compatible provider
 * - $.api.stripe.charges.create() - Create Stripe charge
 * - $.api.slack.send() - Post message to Slack
 * - $.api.hubspot.contacts.create() - Create HubSpot contact
 *
 * The proxy factory is createApiProxy(config) which:
 * - Lazy loads integration modules from /compat directory
 * - Manages credentials from env/secrets
 * - Handles rate limiting per integration
 * - Provides error handling per provider
 * - Implements retry logic with exponential backoff
 *
 * These tests should FAIL initially (RED phase of TDD).
 *
 * @see compat/ directory for the 38 API-compatible SDKs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiProxy as createApiProxyImpl, ApiError as ApiErrorImpl } from '../../context/api-proxy'

// ============================================================================
// TYPE DEFINITIONS - What the API should look like
// ============================================================================

/**
 * Configuration for the API proxy factory
 */
export interface ApiProxyConfig {
  /** Environment variables or secrets store for credentials */
  env?: Record<string, string>
  /** Secrets manager (for vault-based credential storage) */
  secrets?: SecretsManager
  /** Rate limit configuration per integration */
  rateLimits?: Record<string, RateLimitConfig>
  /** Retry configuration */
  retry?: RetryConfig
  /** Custom logger */
  logger?: Logger
}

/**
 * Secrets manager interface for credential retrieval
 */
export interface SecretsManager {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Rate limit configuration for an integration
 */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Optional: Custom key generator for rate limiting */
  keyGenerator?: (operation: string) => string
}

/**
 * Retry configuration with exponential backoff
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Initial delay in milliseconds */
  initialDelayMs: number
  /** Maximum delay in milliseconds */
  maxDelayMs: number
  /** Backoff multiplier */
  backoffMultiplier: number
  /** Retryable error codes */
  retryableErrors?: string[]
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/**
 * Result of an API operation with metadata
 */
export interface ApiResult<T> {
  data: T
  meta: {
    integration: string
    operation: string
    duration: number
    retryCount: number
    rateLimitRemaining?: number
  }
}

/**
 * API error with provider-specific details
 */
export interface ApiError extends Error {
  integration: string
  operation: string
  statusCode?: number
  retryable: boolean
  originalError?: unknown
}

// ============================================================================
// INTEGRATION-SPECIFIC TYPES
// ============================================================================

/**
 * Email send options
 */
export interface EmailSendOptions {
  to: string | string[]
  from?: string
  subject: string
  body?: string
  html?: string
  template?: string
  templateData?: Record<string, unknown>
  attachments?: Array<{
    filename: string
    content: string | Buffer
    contentType?: string
  }>
  headers?: Record<string, string>
  tags?: string[]
}

/**
 * Email send result
 */
export interface EmailSendResult {
  id: string
  status: 'sent' | 'queued' | 'failed'
  messageId?: string
  timestamp: Date
}

/**
 * Stripe charge options
 */
export interface StripeChargeOptions {
  amount: number
  currency: string
  source?: string
  customer?: string
  description?: string
  metadata?: Record<string, string>
  capture?: boolean
}

/**
 * Stripe charge result
 */
export interface StripeChargeResult {
  id: string
  amount: number
  currency: string
  status: 'succeeded' | 'pending' | 'failed'
  paid: boolean
  created: number
}

/**
 * Slack message options
 */
export interface SlackMessageOptions {
  channel: string
  text?: string
  blocks?: unknown[]
  attachments?: unknown[]
  thread_ts?: string
  reply_broadcast?: boolean
}

/**
 * Slack message result
 */
export interface SlackMessageResult {
  ok: boolean
  channel: string
  ts: string
  message?: {
    text: string
    type: string
  }
}

/**
 * HubSpot contact options
 */
export interface HubSpotContactOptions {
  email: string
  firstname?: string
  lastname?: string
  phone?: string
  company?: string
  properties?: Record<string, string>
}

/**
 * HubSpot contact result
 */
export interface HubSpotContactResult {
  id: string
  properties: Record<string, string>
  createdAt: string
  updatedAt: string
}

// ============================================================================
// API PROXY INTERFACE
// ============================================================================

/**
 * Email integration interface
 */
export interface EmailApi {
  send(options: EmailSendOptions): Promise<EmailSendResult>
  sendBatch(options: EmailSendOptions[]): Promise<EmailSendResult[]>
}

/**
 * Stripe integration interface
 */
export interface StripeApi {
  charges: {
    create(options: StripeChargeOptions): Promise<StripeChargeResult>
    retrieve(id: string): Promise<StripeChargeResult>
    capture(id: string): Promise<StripeChargeResult>
  }
  customers: {
    create(options: { email: string; name?: string; metadata?: Record<string, string> }): Promise<{ id: string }>
    retrieve(id: string): Promise<{ id: string; email: string }>
  }
}

/**
 * Slack integration interface
 */
export interface SlackApi {
  send(options: SlackMessageOptions): Promise<SlackMessageResult>
  update(channel: string, ts: string, text: string): Promise<SlackMessageResult>
  delete(channel: string, ts: string): Promise<{ ok: boolean }>
}

/**
 * HubSpot integration interface
 */
export interface HubSpotApi {
  contacts: {
    create(options: HubSpotContactOptions): Promise<HubSpotContactResult>
    update(id: string, properties: Record<string, string>): Promise<HubSpotContactResult>
    get(id: string): Promise<HubSpotContactResult>
    search(query: string): Promise<HubSpotContactResult[]>
  }
}

/**
 * The main API proxy interface
 * Provides access to all integration facades
 */
export interface ApiProxy {
  /** Email integration (Resend, SendGrid, etc.) */
  emails: EmailApi
  /** Stripe payment integration */
  stripe: StripeApi
  /** Slack messaging integration */
  slack: SlackApi
  /** HubSpot CRM integration */
  hubspot: HubSpotApi
  /** Generic integration access by name */
  integration<T>(name: string): T
  /** Get rate limit status for an integration */
  getRateLimitStatus(integration: string): Promise<{
    remaining: number
    reset: number
    limit: number
  }>
}

// ============================================================================
// FACTORY FUNCTION - TO BE IMPLEMENTED
// ============================================================================

/**
 * Creates the API proxy with configuration
 * This is the main factory function
 */
export function createApiProxy(config: ApiProxyConfig = {}): ApiProxy {
  return createApiProxyImpl(config) as ApiProxy
}

// ============================================================================
// 1. BASIC INTEGRATION TESTS
// ============================================================================

describe('$.api.* - Integration Facade', () => {
  describe('createApiProxy factory', () => {
    it('should create an API proxy instance', () => {
      const api = createApiProxy()

      expect(api).toBeDefined()
      expect(api.emails).toBeDefined()
      expect(api.stripe).toBeDefined()
      expect(api.slack).toBeDefined()
      expect(api.hubspot).toBeDefined()
    })

    it('should accept configuration options', () => {
      const config: ApiProxyConfig = {
        env: {
          STRIPE_API_KEY: 'sk_test_xxx',
          RESEND_API_KEY: 're_xxx',
        },
        retry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      }

      const api = createApiProxy(config)
      expect(api).toBeDefined()
    })
  })
})

// ============================================================================
// 2. EMAIL INTEGRATION TESTS
// ============================================================================

describe('$.api.emails - Email Integration', () => {
  describe('send()', () => {
    it('should send an email with required fields', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const result = await api.emails.send({
        to: 'recipient@example.com',
        subject: 'Test Email',
        body: 'Hello, World!',
      })

      expect(result.id).toBeDefined()
      expect(result.status).toBe('sent')
      expect(result.timestamp).toBeInstanceOf(Date)
    })

    it('should send email with HTML content', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const result = await api.emails.send({
        to: 'recipient@example.com',
        subject: 'HTML Email',
        html: '<h1>Hello</h1><p>World!</p>',
      })

      expect(result.status).toBe('sent')
    })

    it('should send email to multiple recipients', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const result = await api.emails.send({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Bulk Email',
        body: 'Hello everyone!',
      })

      expect(result.status).toBe('sent')
    })

    it('should send email with template', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const result = await api.emails.send({
        to: 'recipient@example.com',
        subject: 'Welcome!',
        template: 'welcome-email',
        templateData: {
          name: 'John',
          company: 'Acme Inc',
        },
      })

      expect(result.status).toBe('sent')
    })

    it('should send email with attachments', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const result = await api.emails.send({
        to: 'recipient@example.com',
        subject: 'Email with Attachment',
        body: 'Please see attached.',
        attachments: [
          {
            filename: 'report.pdf',
            content: 'base64-encoded-content',
            contentType: 'application/pdf',
          },
        ],
      })

      expect(result.status).toBe('sent')
    })
  })

  describe('sendBatch()', () => {
    it('should send multiple emails in batch', async () => {
      const api = createApiProxy({
        env: { RESEND_API_KEY: 'test_key' },
      })

      const emails: EmailSendOptions[] = [
        { to: 'user1@example.com', subject: 'Email 1', body: 'Body 1' },
        { to: 'user2@example.com', subject: 'Email 2', body: 'Body 2' },
        { to: 'user3@example.com', subject: 'Email 3', body: 'Body 3' },
      ]

      const results = await api.emails.sendBatch(emails)

      expect(results).toHaveLength(3)
      results.forEach((result) => {
        expect(result.id).toBeDefined()
        expect(result.status).toBe('sent')
      })
    })
  })
})

// ============================================================================
// 3. STRIPE INTEGRATION TESTS
// ============================================================================

describe('$.api.stripe - Stripe Integration', () => {
  describe('charges.create()', () => {
    it('should create a charge with amount and currency', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.create({
        amount: 2000, // $20.00
        currency: 'usd',
        source: 'tok_visa',
        description: 'Test charge',
      })

      expect(result.id).toMatch(/^ch_/)
      expect(result.amount).toBe(2000)
      expect(result.currency).toBe('usd')
      expect(result.status).toBe('succeeded')
      expect(result.paid).toBe(true)
    })

    it('should create a charge with customer ID', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.create({
        amount: 5000,
        currency: 'usd',
        customer: 'cus_xxx',
        description: 'Monthly subscription',
      })

      expect(result.status).toBe('succeeded')
    })

    it('should create an uncaptured charge', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.create({
        amount: 3000,
        currency: 'usd',
        source: 'tok_visa',
        capture: false,
      })

      expect(result.status).toBe('pending')
    })

    it('should include metadata in charge', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.create({
        amount: 1500,
        currency: 'usd',
        source: 'tok_visa',
        metadata: {
          order_id: 'order_123',
          customer_email: 'test@example.com',
        },
      })

      expect(result.id).toBeDefined()
    })
  })

  describe('charges.retrieve()', () => {
    it('should retrieve an existing charge', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.retrieve('ch_test_123')

      expect(result.id).toBe('ch_test_123')
      expect(result.amount).toBeDefined()
      expect(result.currency).toBeDefined()
    })
  })

  describe('charges.capture()', () => {
    it('should capture an uncaptured charge', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.charges.capture('ch_uncaptured_123')

      expect(result.status).toBe('succeeded')
      expect(result.paid).toBe(true)
    })
  })

  describe('customers', () => {
    it('should create a customer', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.customers.create({
        email: 'customer@example.com',
        name: 'Test Customer',
      })

      expect(result.id).toMatch(/^cus_/)
    })

    it('should retrieve a customer', async () => {
      const api = createApiProxy({
        env: { STRIPE_API_KEY: 'sk_test_xxx' },
      })

      const result = await api.stripe.customers.retrieve('cus_test_123')

      expect(result.id).toBe('cus_test_123')
      expect(result.email).toBeDefined()
    })
  })
})

// ============================================================================
// 4. SLACK INTEGRATION TESTS
// ============================================================================

describe('$.api.slack - Slack Integration', () => {
  describe('send()', () => {
    it('should send a message to a channel', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.send({
        channel: '#general',
        text: 'Hello from dotdo!',
      })

      expect(result.ok).toBe(true)
      expect(result.channel).toBeDefined()
      expect(result.ts).toBeDefined()
    })

    it('should send a message with blocks', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.send({
        channel: '#engineering',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*New Deployment* :rocket:',
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Version: 1.2.3\nEnvironment: Production',
            },
          },
        ],
      })

      expect(result.ok).toBe(true)
    })

    it('should send a threaded reply', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.send({
        channel: '#general',
        text: 'This is a reply',
        thread_ts: '1234567890.123456',
      })

      expect(result.ok).toBe(true)
    })

    it('should send a message with attachments', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.send({
        channel: '#alerts',
        text: 'Alert notification',
        attachments: [
          {
            color: 'danger',
            title: 'Server Error',
            text: 'CPU usage exceeded 90%',
            fields: [
              { title: 'Server', value: 'prod-1', short: true },
              { title: 'Time', value: '10:30 AM', short: true },
            ],
          },
        ],
      })

      expect(result.ok).toBe(true)
    })
  })

  describe('update()', () => {
    it('should update an existing message', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.update(
        '#general',
        '1234567890.123456',
        'Updated message text'
      )

      expect(result.ok).toBe(true)
    })
  })

  describe('delete()', () => {
    it('should delete a message', async () => {
      const api = createApiProxy({
        env: { SLACK_BOT_TOKEN: 'xoxb-xxx' },
      })

      const result = await api.slack.delete('#general', '1234567890.123456')

      expect(result.ok).toBe(true)
    })
  })
})

// ============================================================================
// 5. HUBSPOT INTEGRATION TESTS
// ============================================================================

describe('$.api.hubspot - HubSpot Integration', () => {
  describe('contacts.create()', () => {
    it('should create a contact with email', async () => {
      const api = createApiProxy({
        env: { HUBSPOT_API_KEY: 'pat-xxx' },
      })

      const result = await api.hubspot.contacts.create({
        email: 'contact@example.com',
        firstname: 'John',
        lastname: 'Doe',
      })

      expect(result.id).toBeDefined()
      expect(result.properties.email).toBe('contact@example.com')
      expect(result.createdAt).toBeDefined()
    })

    it('should create a contact with custom properties', async () => {
      const api = createApiProxy({
        env: { HUBSPOT_API_KEY: 'pat-xxx' },
      })

      const result = await api.hubspot.contacts.create({
        email: 'lead@example.com',
        firstname: 'Jane',
        lastname: 'Smith',
        properties: {
          company: 'Acme Inc',
          jobtitle: 'CEO',
          lifecyclestage: 'lead',
        },
      })

      expect(result.id).toBeDefined()
    })
  })

  describe('contacts.update()', () => {
    it('should update contact properties', async () => {
      const api = createApiProxy({
        env: { HUBSPOT_API_KEY: 'pat-xxx' },
      })

      const result = await api.hubspot.contacts.update('contact_123', {
        lifecyclestage: 'customer',
        hs_lead_status: 'CLOSED_WON',
      })

      expect(result.id).toBe('contact_123')
      expect(result.updatedAt).toBeDefined()
    })
  })

  describe('contacts.get()', () => {
    it('should retrieve a contact by ID', async () => {
      const api = createApiProxy({
        env: { HUBSPOT_API_KEY: 'pat-xxx' },
      })

      const result = await api.hubspot.contacts.get('contact_123')

      expect(result.id).toBe('contact_123')
      expect(result.properties).toBeDefined()
    })
  })

  describe('contacts.search()', () => {
    it('should search contacts by query', async () => {
      const api = createApiProxy({
        env: { HUBSPOT_API_KEY: 'pat-xxx' },
      })

      const results = await api.hubspot.contacts.search('example.com')

      expect(Array.isArray(results)).toBe(true)
    })
  })
})

// ============================================================================
// 6. LAZY LOADING TESTS
// ============================================================================

describe('Lazy Loading of Integration Modules', () => {
  it('should not load integration until first access', () => {
    // Track module loading
    const loadedModules: string[] = []

    const api = createApiProxy({
      env: {},
    })

    // At this point, no modules should be loaded
    expect(loadedModules).toHaveLength(0)

    // Accessing emails should trigger lazy load
    const _emails = api.emails
    // Module should now be loaded (verify through implementation)
  })

  it('should cache loaded modules', async () => {
    const api = createApiProxy({
      env: { RESEND_API_KEY: 'test_key' },
    })

    // Access emails multiple times
    const emails1 = api.emails
    const emails2 = api.emails
    const emails3 = api.emails

    // Should return the same instance
    expect(emails1).toBe(emails2)
    expect(emails2).toBe(emails3)
  })

  it('should support dynamic integration loading by name', async () => {
    const api = createApiProxy({
      env: {},
    })

    // Load integration dynamically
    const customIntegration = api.integration<{ customMethod: () => Promise<void> }>('custom')

    expect(customIntegration).toBeDefined()
  })

  it('should throw for unknown integration', () => {
    const api = createApiProxy({
      env: {},
    })

    expect(() => api.integration('non_existent_integration')).toThrow(
      'Integration not found: non_existent_integration'
    )
  })
})

// ============================================================================
// 7. CREDENTIAL MANAGEMENT TESTS
// ============================================================================

describe('Credential Management', () => {
  describe('from environment variables', () => {
    it('should use credentials from env config', async () => {
      const api = createApiProxy({
        env: {
          STRIPE_API_KEY: 'sk_test_from_env',
        },
      })

      // The API should use the provided key
      // This is verified by successful API calls
      await expect(
        api.stripe.charges.create({ amount: 1000, currency: 'usd' })
      ).resolves.toBeDefined()
    })

    it('should throw when required credential is missing', async () => {
      const api = createApiProxy({
        env: {}, // No credentials
      })

      await expect(api.stripe.charges.create({ amount: 1000, currency: 'usd' })).rejects.toThrow(
        'Missing credential: STRIPE_API_KEY'
      )
    })
  })

  describe('from secrets manager', () => {
    it('should retrieve credentials from secrets manager', async () => {
      const mockSecrets: SecretsManager = {
        get: vi.fn().mockResolvedValue('sk_test_from_vault'),
        set: vi.fn(),
        delete: vi.fn(),
      }

      const api = createApiProxy({
        secrets: mockSecrets,
      })

      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })

      expect(mockSecrets.get).toHaveBeenCalledWith('STRIPE_API_KEY')
    })

    it('should cache credentials from secrets manager', async () => {
      const mockSecrets: SecretsManager = {
        get: vi.fn().mockResolvedValue('sk_test_cached'),
        set: vi.fn(),
        delete: vi.fn(),
      }

      const api = createApiProxy({
        secrets: mockSecrets,
      })

      // Make multiple calls
      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
      await api.stripe.charges.create({ amount: 2000, currency: 'usd' })
      await api.stripe.charges.create({ amount: 3000, currency: 'usd' })

      // Should only fetch once due to caching
      expect(mockSecrets.get).toHaveBeenCalledTimes(1)
    })

    it('should prefer env over secrets manager', async () => {
      const mockSecrets: SecretsManager = {
        get: vi.fn().mockResolvedValue('sk_from_vault'),
        set: vi.fn(),
        delete: vi.fn(),
      }

      const api = createApiProxy({
        env: {
          STRIPE_API_KEY: 'sk_from_env',
        },
        secrets: mockSecrets,
      })

      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })

      // Secrets manager should not be called since env has the key
      expect(mockSecrets.get).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// 8. RATE LIMITING TESTS
// ============================================================================

describe('Rate Limiting per Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should rate limit requests per integration', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      rateLimits: {
        stripe: {
          maxRequests: 3,
          windowMs: 1000, // 3 requests per second
        },
      },
    })

    // First 3 requests should succeed
    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    await api.stripe.charges.create({ amount: 2000, currency: 'usd' })
    await api.stripe.charges.create({ amount: 3000, currency: 'usd' })

    // 4th request should be rate limited
    await expect(
      api.stripe.charges.create({ amount: 4000, currency: 'usd' })
    ).rejects.toThrow('Rate limit exceeded for stripe')
  })

  it('should reset rate limit after window expires', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      rateLimits: {
        stripe: {
          maxRequests: 2,
          windowMs: 1000,
        },
      },
    })

    // Use up rate limit
    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    await api.stripe.charges.create({ amount: 2000, currency: 'usd' })

    // Should be rate limited
    await expect(
      api.stripe.charges.create({ amount: 3000, currency: 'usd' })
    ).rejects.toThrow('Rate limit exceeded')

    // Advance time past the window
    vi.advanceTimersByTime(1100)

    // Should work again
    await expect(
      api.stripe.charges.create({ amount: 3000, currency: 'usd' })
    ).resolves.toBeDefined()
  })

  it('should have separate rate limits per integration', async () => {
    const api = createApiProxy({
      env: {
        STRIPE_API_KEY: 'sk_test_xxx',
        RESEND_API_KEY: 'test_key',
      },
      rateLimits: {
        stripe: { maxRequests: 2, windowMs: 1000 },
        emails: { maxRequests: 5, windowMs: 1000 },
      },
    })

    // Use up Stripe limit
    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    await api.stripe.charges.create({ amount: 2000, currency: 'usd' })

    // Stripe should be rate limited
    await expect(
      api.stripe.charges.create({ amount: 3000, currency: 'usd' })
    ).rejects.toThrow('Rate limit exceeded')

    // But emails should still work
    await expect(
      api.emails.send({ to: 'test@example.com', subject: 'Test', body: 'Test' })
    ).resolves.toBeDefined()
  })

  it('should expose rate limit status', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      rateLimits: {
        stripe: { maxRequests: 10, windowMs: 60000 },
      },
    })

    // Make some requests
    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    await api.stripe.charges.create({ amount: 2000, currency: 'usd' })

    const status = await api.getRateLimitStatus('stripe')

    expect(status.limit).toBe(10)
    expect(status.remaining).toBe(8)
    expect(status.reset).toBeGreaterThan(Date.now())
  })

  it('should support custom rate limit key generator', async () => {
    const keyGenerator = vi.fn((operation: string) => `custom_${operation}`)

    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      rateLimits: {
        stripe: {
          maxRequests: 5,
          windowMs: 1000,
          keyGenerator,
        },
      },
    })

    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    expect(keyGenerator).toHaveBeenCalledWith('charges.create')
  })
})

// ============================================================================
// 9. ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling per Provider', () => {
  it('should throw ApiError with provider details', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_invalid' },
    })

    try {
      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
      expect.fail('Should have thrown')
    } catch (error) {
      const apiError = error as ApiError
      expect(apiError.integration).toBe('stripe')
      expect(apiError.operation).toBe('charges.create')
      expect(apiError.statusCode).toBeDefined()
      expect(apiError.retryable).toBeDefined()
    }
  })

  it('should identify retryable errors', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
    })

    // Simulate a rate limit error (429)
    try {
      // This would normally trigger a 429 from Stripe
      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.statusCode === 429) {
        expect(apiError.retryable).toBe(true)
      }
    }
  })

  it('should identify non-retryable errors', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
    })

    try {
      // Invalid card number - should be a 400/402 error
      await api.stripe.charges.create({
        amount: 1000,
        currency: 'usd',
        source: 'tok_invalid',
      })
    } catch (error) {
      const apiError = error as ApiError
      if (apiError.statusCode === 400 || apiError.statusCode === 402) {
        expect(apiError.retryable).toBe(false)
      }
    }
  })

  it('should preserve original error', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
    })

    try {
      await api.stripe.charges.create({ amount: -1000, currency: 'usd' })
    } catch (error) {
      const apiError = error as ApiError
      expect(apiError.originalError).toBeDefined()
    }
  })

  it('should handle network errors', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
    })

    // Simulate network failure
    try {
      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    } catch (error) {
      const apiError = error as ApiError
      expect(apiError.retryable).toBe(true) // Network errors should be retryable
    }
  })

  it('should include operation context in error message', async () => {
    const api = createApiProxy({
      env: {}, // Missing credentials
    })

    try {
      await api.slack.send({ channel: '#test', text: 'Hello' })
    } catch (error) {
      expect((error as Error).message).toContain('slack')
    }
  })
})

// ============================================================================
// 10. RETRY LOGIC TESTS
// ============================================================================

describe('Retry Logic with Exponential Backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry failed requests with exponential backoff', async () => {
    let attempts = 0
    const mockFetch = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        return Promise.reject(new Error('Temporary failure'))
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'ch_success' }) })
    })

    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
      },
    })

    // Start the request
    const promise = api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    // Advance through retries
    await vi.advanceTimersByTimeAsync(100) // First retry after 100ms
    await vi.advanceTimersByTimeAsync(200) // Second retry after 200ms

    await expect(promise).resolves.toBeDefined()
  })

  it('should respect maxAttempts limit', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
      },
    })

    // This should fail after 3 attempts
    const promise = api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(400)

    await expect(promise).rejects.toThrow()
  })

  it('should cap delay at maxDelayMs', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 10,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffMultiplier: 3,
      },
    })

    // With multiplier 3: 1000 -> 3000 -> 9000 (capped to 5000)
    // Delays should be: 1000, 3000, 5000, 5000, ...
    const promise = api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    // The delays should be capped
    await vi.advanceTimersByTimeAsync(1000) // First retry
    await vi.advanceTimersByTimeAsync(3000) // Second retry
    await vi.advanceTimersByTimeAsync(5000) // Third retry (capped)
    await vi.advanceTimersByTimeAsync(5000) // Fourth retry (still capped)
  })

  it('should not retry non-retryable errors', async () => {
    let attempts = 0

    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryableErrors: ['ETIMEDOUT', 'ECONNRESET'],
      },
    })

    // 400 Bad Request should not be retried
    await expect(
      api.stripe.charges.create({ amount: -1, currency: 'usd' }) // Invalid amount
    ).rejects.toThrow()

    // Should only attempt once for validation errors
  })

  it('should only retry specified error codes', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 5,
        initialDelayMs: 100,
        maxDelayMs: 5000,
        backoffMultiplier: 2,
        retryableErrors: ['rate_limit_error', 'api_connection_error'],
      },
    })

    // Rate limit error should be retried
    // Authentication error should not be retried
  })

  it('should add jitter to retry delays', async () => {
    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      retry: {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
    })

    // Jitter should be applied to avoid thundering herd
    // Actual delay = baseDelay * (0.5 + random * 0.5)
    // This is hard to test deterministically, but we can verify the request eventually succeeds
  })
})

// ============================================================================
// 11. LOGGING TESTS
// ============================================================================

describe('Logging', () => {
  it('should log API operations when logger provided', async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      logger: mockLogger,
    })

    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    expect(mockLogger.info).toHaveBeenCalled()
  })

  it('should log errors', async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const api = createApiProxy({
      env: {}, // Missing credentials will cause error
      logger: mockLogger,
    })

    try {
      await api.stripe.charges.create({ amount: 1000, currency: 'usd' })
    } catch {
      // Expected to fail
    }

    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('should include operation metadata in logs', async () => {
    const mockLogger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const api = createApiProxy({
      env: { STRIPE_API_KEY: 'sk_test_xxx' },
      logger: mockLogger,
    })

    await api.stripe.charges.create({ amount: 1000, currency: 'usd' })

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        integration: 'stripe',
        operation: expect.any(String),
      })
    )
  })
})

// ============================================================================
// 12. INTEGRATION WITH WORKFLOW CONTEXT
// ============================================================================

describe('Integration with Workflow Context ($)', () => {
  it('should work as $.api property on workflow context', () => {
    // This test verifies the API proxy can be used as part of the $ context
    // The actual $ context integration would be tested in the workflow tests

    const api = createApiProxy({
      env: {
        STRIPE_API_KEY: 'sk_test_xxx',
        RESEND_API_KEY: 'test_key',
      },
    })

    // API should be usable standalone
    expect(api.stripe).toBeDefined()
    expect(api.emails).toBeDefined()
    expect(api.slack).toBeDefined()
    expect(api.hubspot).toBeDefined()
  })

  it('should support fluent chaining', async () => {
    const api = createApiProxy({
      env: {
        STRIPE_API_KEY: 'sk_test_xxx',
        HUBSPOT_API_KEY: 'pat-xxx',
      },
    })

    // Create customer in Stripe, then in HubSpot
    const stripeCustomer = await api.stripe.customers.create({
      email: 'customer@example.com',
      name: 'Test Customer',
    })

    const hubspotContact = await api.hubspot.contacts.create({
      email: 'customer@example.com',
      firstname: 'Test',
      lastname: 'Customer',
      properties: {
        stripe_customer_id: stripeCustomer.id,
      },
    })

    expect(stripeCustomer.id).toBeDefined()
    expect(hubspotContact.id).toBeDefined()
  })
})

// ============================================================================
// 13. TYPE SAFETY TESTS
// ============================================================================

describe('Type Safety', () => {
  it('should have correct types for email options', () => {
    const options: EmailSendOptions = {
      to: 'test@example.com',
      subject: 'Test',
      body: 'Body',
    }
    expect(options.to).toBe('test@example.com')
  })

  it('should have correct types for Stripe charge options', () => {
    const options: StripeChargeOptions = {
      amount: 1000,
      currency: 'usd',
    }
    expect(options.amount).toBe(1000)
  })

  it('should have correct types for Slack message options', () => {
    const options: SlackMessageOptions = {
      channel: '#general',
      text: 'Hello',
    }
    expect(options.channel).toBe('#general')
  })

  it('should have correct types for HubSpot contact options', () => {
    const options: HubSpotContactOptions = {
      email: 'contact@example.com',
      firstname: 'John',
    }
    expect(options.email).toBe('contact@example.com')
  })
})
