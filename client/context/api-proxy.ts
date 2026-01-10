/**
 * $.api.* Integration Facade
 *
 * Provides a unified interface to all integration SDKs with:
 * - Lazy loading of integration modules
 * - Credential management (env + secrets)
 * - Rate limiting per integration
 * - Retry logic with exponential backoff
 * - Unified error handling
 *
 * @example
 * ```typescript
 * const api = createApiProxy({
 *   env: {
 *     STRIPE_API_KEY: 'sk_xxx',
 *     RESEND_API_KEY: 're_xxx',
 *   },
 * })
 *
 * // Send email
 * await api.emails.send({
 *   to: 'user@example.com',
 *   subject: 'Hello',
 *   body: 'World',
 * })
 *
 * // Create Stripe charge
 * await api.stripe.charges.create({
 *   amount: 2000,
 *   currency: 'usd',
 * })
 * ```
 */

// ============================================================================
// TYPE DEFINITIONS
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
export class ApiError extends Error {
  integration: string
  operation: string
  statusCode?: number
  retryable: boolean
  originalError?: unknown

  constructor(
    message: string,
    integration: string,
    operation: string,
    options: {
      statusCode?: number
      retryable?: boolean
      originalError?: unknown
    } = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.integration = integration
    this.operation = operation
    this.statusCode = options.statusCode
    this.retryable = options.retryable ?? false
    this.originalError = options.originalError
  }
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
// RATE LIMITER
// ============================================================================

interface RateLimitState {
  count: number
  windowStart: number
}

class RateLimiter {
  private states = new Map<string, RateLimitState>()
  private config: Record<string, RateLimitConfig>

  constructor(config: Record<string, RateLimitConfig> = {}) {
    this.config = config
  }

  getKey(integration: string, operation: string): string {
    const limit = this.config[integration]
    if (limit?.keyGenerator) {
      return `${integration}:${limit.keyGenerator(operation)}`
    }
    return integration
  }

  check(integration: string, operation: string): void {
    const limit = this.config[integration]
    if (!limit) return

    const key = this.getKey(integration, operation)
    const now = Date.now()
    const state = this.states.get(key)

    if (!state || now - state.windowStart >= limit.windowMs) {
      // New window
      this.states.set(key, { count: 1, windowStart: now })
      return
    }

    if (state.count >= limit.maxRequests) {
      throw new ApiError(
        `Rate limit exceeded for ${integration}`,
        integration,
        operation,
        { statusCode: 429, retryable: true }
      )
    }

    state.count++
  }

  getStatus(integration: string): { remaining: number; reset: number; limit: number } {
    const limit = this.config[integration]
    if (!limit) {
      return { remaining: Infinity, reset: 0, limit: Infinity }
    }

    const key = integration
    const state = this.states.get(key)
    const now = Date.now()

    if (!state || now - state.windowStart >= limit.windowMs) {
      return {
        remaining: limit.maxRequests,
        reset: now + limit.windowMs,
        limit: limit.maxRequests,
      }
    }

    return {
      remaining: Math.max(0, limit.maxRequests - state.count),
      reset: state.windowStart + limit.windowMs,
      limit: limit.maxRequests,
    }
  }
}

// ============================================================================
// CREDENTIAL MANAGER
// ============================================================================

class CredentialManager {
  private env: Record<string, string>
  private secrets?: SecretsManager
  private cache = new Map<string, string>()

  constructor(env: Record<string, string> = {}, secrets?: SecretsManager) {
    this.env = env
    this.secrets = secrets
  }

  async get(key: string): Promise<string | undefined> {
    // Check env first (higher priority)
    if (this.env[key]) {
      return this.env[key]
    }

    // Check cache
    if (this.cache.has(key)) {
      return this.cache.get(key)
    }

    // Try secrets manager
    if (this.secrets) {
      const value = await this.secrets.get(key)
      if (value) {
        this.cache.set(key, value)
        return value
      }
    }

    return undefined
  }

  async require(key: string, integration: string, operation: string): Promise<string> {
    const value = await this.get(key)
    if (!value) {
      throw new ApiError(
        `[${integration}] Missing credential: ${key}`,
        integration,
        operation,
        { retryable: false }
      )
    }
    return value
  }
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
}

function isRetryableError(error: unknown, retryConfig: RetryConfig): boolean {
  if (error instanceof ApiError) {
    // If specific retryable errors are defined, check against them
    if (retryConfig.retryableErrors?.length) {
      // Check for error code matches
      const errorCode = (error.originalError as { code?: string })?.code
      if (errorCode && retryConfig.retryableErrors.includes(errorCode)) {
        return true
      }
    }
    return error.retryable
  }

  // Network errors are generally retryable
  if (error instanceof Error) {
    const networkErrors = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND']
    const errorCode = (error as { code?: string }).code
    if (errorCode && networkErrors.includes(errorCode)) {
      return true
    }
  }

  return false
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const baseDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1)
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs)
  // Add jitter: delay * (0.5 + random * 0.5)
  const jitter = 0.5 + Math.random() * 0.5
  return Math.floor(cappedDelay * jitter)
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  integration: string,
  operation: string,
  logger?: Logger
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isRetryableError(error, config)) {
        throw error
      }

      if (attempt < config.maxAttempts) {
        const delay = calculateDelay(attempt, config)
        logger?.warn(`Retrying ${integration}.${operation} after ${delay}ms (attempt ${attempt}/${config.maxAttempts})`, {
          integration,
          operation,
          attempt,
          delay,
        })
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

// ============================================================================
// INTEGRATION IMPLEMENTATIONS (Mock/Test Mode)
// ============================================================================

function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = prefix
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function createEmailApi(
  credentials: CredentialManager,
  rateLimiter: RateLimiter,
  retryConfig: RetryConfig,
  logger?: Logger
): EmailApi {
  const execute = async <T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    rateLimiter.check('emails', operation)
    await credentials.require('RESEND_API_KEY', 'emails', operation)

    const startTime = Date.now()
    try {
      const result = await withRetry(fn, retryConfig, 'emails', operation, logger)
      const duration = Date.now() - startTime
      logger?.info(`emails.${operation} completed`, { integration: 'emails', operation, duration })
      return result
    } catch (error) {
      logger?.error(`emails.${operation} failed`, { integration: 'emails', operation, error })
      throw error
    }
  }

  return {
    async send(options: EmailSendOptions): Promise<EmailSendResult> {
      return execute('send', async () => ({
        id: generateId('msg_'),
        status: 'sent' as const,
        messageId: generateId('mid_'),
        timestamp: new Date(),
      }))
    },

    async sendBatch(emails: EmailSendOptions[]): Promise<EmailSendResult[]> {
      return execute('sendBatch', async () =>
        emails.map(() => ({
          id: generateId('msg_'),
          status: 'sent' as const,
          messageId: generateId('mid_'),
          timestamp: new Date(),
        }))
      )
    },
  }
}

function createStripeApi(
  credentials: CredentialManager,
  rateLimiter: RateLimiter,
  retryConfig: RetryConfig,
  logger?: Logger
): StripeApi {
  const execute = async <T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    const startTime = Date.now()
    try {
      rateLimiter.check('stripe', operation)
      const apiKey = await credentials.require('STRIPE_API_KEY', 'stripe', operation)

      // Validate API key format (simulate authentication)
      if (apiKey === 'sk_test_invalid' || apiKey.includes('invalid')) {
        throw new ApiError(
          'Invalid API key provided',
          'stripe',
          operation,
          { statusCode: 401, retryable: false, originalError: new Error('Invalid API Key') }
        )
      }

      const result = await withRetry(fn, retryConfig, 'stripe', operation, logger)
      const duration = Date.now() - startTime
      logger?.info(`stripe.${operation} completed`, { integration: 'stripe', operation, duration })
      return result
    } catch (error) {
      logger?.error(`stripe.${operation} failed`, { integration: 'stripe', operation, error })
      throw error
    }
  }

  return {
    charges: {
      async create(options: StripeChargeOptions): Promise<StripeChargeResult> {
        return execute('charges.create', async () => {
          // Validation
          if (options.amount < 0) {
            throw new ApiError(
              'Invalid amount',
              'stripe',
              'charges.create',
              { statusCode: 400, retryable: false, originalError: new Error('Amount must be positive') }
            )
          }
          if (options.source === 'tok_invalid') {
            throw new ApiError(
              'Invalid card',
              'stripe',
              'charges.create',
              { statusCode: 402, retryable: false, originalError: new Error('Card declined') }
            )
          }

          return {
            id: generateId('ch_'),
            amount: options.amount,
            currency: options.currency,
            status: options.capture === false ? 'pending' : 'succeeded',
            paid: options.capture !== false,
            created: Math.floor(Date.now() / 1000),
          }
        })
      },

      async retrieve(id: string): Promise<StripeChargeResult> {
        return execute('charges.retrieve', async () => ({
          id,
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
          paid: true,
          created: Math.floor(Date.now() / 1000),
        }))
      },

      async capture(id: string): Promise<StripeChargeResult> {
        return execute('charges.capture', async () => ({
          id,
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
          paid: true,
          created: Math.floor(Date.now() / 1000),
        }))
      },
    },

    customers: {
      async create(options: { email: string; name?: string; metadata?: Record<string, string> }): Promise<{ id: string }> {
        return execute('customers.create', async () => ({
          id: generateId('cus_'),
        }))
      },

      async retrieve(id: string): Promise<{ id: string; email: string }> {
        return execute('customers.retrieve', async () => ({
          id,
          email: 'customer@example.com',
        }))
      },
    },
  }
}

function createSlackApi(
  credentials: CredentialManager,
  rateLimiter: RateLimiter,
  retryConfig: RetryConfig,
  logger?: Logger
): SlackApi {
  const execute = async <T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    rateLimiter.check('slack', operation)
    await credentials.require('SLACK_BOT_TOKEN', 'slack', operation)

    const startTime = Date.now()
    try {
      const result = await withRetry(fn, retryConfig, 'slack', operation, logger)
      const duration = Date.now() - startTime
      logger?.info(`slack.${operation} completed`, { integration: 'slack', operation, duration })
      return result
    } catch (error) {
      logger?.error(`slack.${operation} failed`, { integration: 'slack', operation, error })
      throw error
    }
  }

  return {
    async send(options: SlackMessageOptions): Promise<SlackMessageResult> {
      return execute('send', async () => ({
        ok: true,
        channel: options.channel,
        ts: `${Date.now() / 1000}.${Math.floor(Math.random() * 1000000)}`,
        message: options.text ? { text: options.text, type: 'message' } : undefined,
      }))
    },

    async update(channel: string, ts: string, text: string): Promise<SlackMessageResult> {
      return execute('update', async () => ({
        ok: true,
        channel,
        ts,
        message: { text, type: 'message' },
      }))
    },

    async delete(channel: string, ts: string): Promise<{ ok: boolean }> {
      return execute('delete', async () => ({
        ok: true,
      }))
    },
  }
}

function createHubSpotApi(
  credentials: CredentialManager,
  rateLimiter: RateLimiter,
  retryConfig: RetryConfig,
  logger?: Logger
): HubSpotApi {
  const execute = async <T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> => {
    rateLimiter.check('hubspot', operation)
    await credentials.require('HUBSPOT_API_KEY', 'hubspot', operation)

    const startTime = Date.now()
    try {
      const result = await withRetry(fn, retryConfig, 'hubspot', operation, logger)
      const duration = Date.now() - startTime
      logger?.info(`hubspot.${operation} completed`, { integration: 'hubspot', operation, duration })
      return result
    } catch (error) {
      logger?.error(`hubspot.${operation} failed`, { integration: 'hubspot', operation, error })
      throw error
    }
  }

  return {
    contacts: {
      async create(options: HubSpotContactOptions): Promise<HubSpotContactResult> {
        return execute('contacts.create', async () => {
          const now = new Date().toISOString()
          const properties: Record<string, string> = {
            email: options.email,
          }
          if (options.firstname) properties.firstname = options.firstname
          if (options.lastname) properties.lastname = options.lastname
          if (options.phone) properties.phone = options.phone
          if (options.company) properties.company = options.company
          if (options.properties) Object.assign(properties, options.properties)

          return {
            id: generateId(''),
            properties,
            createdAt: now,
            updatedAt: now,
          }
        })
      },

      async update(id: string, properties: Record<string, string>): Promise<HubSpotContactResult> {
        return execute('contacts.update', async () => ({
          id,
          properties,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }))
      },

      async get(id: string): Promise<HubSpotContactResult> {
        return execute('contacts.get', async () => ({
          id,
          properties: { email: 'contact@example.com' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }))
      },

      async search(query: string): Promise<HubSpotContactResult[]> {
        return execute('contacts.search', async () => [])
      },
    },
  }
}

// ============================================================================
// KNOWN INTEGRATIONS REGISTRY
// ============================================================================

const KNOWN_INTEGRATIONS = new Set([
  'emails',
  'stripe',
  'slack',
  'hubspot',
  'twilio',
  'sendgrid',
  'resend',
  'custom',
])

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Creates the API proxy with configuration
 * This is the main factory function
 */
export function createApiProxy(config: ApiProxyConfig = {}): ApiProxy {
  const credentials = new CredentialManager(config.env ?? {}, config.secrets)
  const rateLimiter = new RateLimiter(config.rateLimits ?? {})
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry }
  const logger = config.logger

  // Lazy-loaded integration instances
  let emailsInstance: EmailApi | null = null
  let stripeInstance: StripeApi | null = null
  let slackInstance: SlackApi | null = null
  let hubspotInstance: HubSpotApi | null = null
  const dynamicIntegrations = new Map<string, unknown>()

  const proxy: ApiProxy = {
    get emails(): EmailApi {
      if (!emailsInstance) {
        emailsInstance = createEmailApi(credentials, rateLimiter, retryConfig, logger)
      }
      return emailsInstance
    },

    get stripe(): StripeApi {
      if (!stripeInstance) {
        stripeInstance = createStripeApi(credentials, rateLimiter, retryConfig, logger)
      }
      return stripeInstance
    },

    get slack(): SlackApi {
      if (!slackInstance) {
        slackInstance = createSlackApi(credentials, rateLimiter, retryConfig, logger)
      }
      return slackInstance
    },

    get hubspot(): HubSpotApi {
      if (!hubspotInstance) {
        hubspotInstance = createHubSpotApi(credentials, rateLimiter, retryConfig, logger)
      }
      return hubspotInstance
    },

    integration<T>(name: string): T {
      if (!KNOWN_INTEGRATIONS.has(name)) {
        throw new Error(`Integration not found: ${name}`)
      }

      // Return cached instance if exists
      if (dynamicIntegrations.has(name)) {
        return dynamicIntegrations.get(name) as T
      }

      // Map known integration names to their implementations
      switch (name) {
        case 'emails':
          return proxy.emails as unknown as T
        case 'stripe':
          return proxy.stripe as unknown as T
        case 'slack':
          return proxy.slack as unknown as T
        case 'hubspot':
          return proxy.hubspot as unknown as T
        case 'custom':
          // Create a minimal custom integration stub
          const customIntegration = {
            customMethod: async () => {},
          }
          dynamicIntegrations.set(name, customIntegration)
          return customIntegration as T
        default:
          // For other known integrations, return a minimal stub
          const stub = {}
          dynamicIntegrations.set(name, stub)
          return stub as T
      }
    },

    async getRateLimitStatus(integration: string): Promise<{
      remaining: number
      reset: number
      limit: number
    }> {
      return rateLimiter.getStatus(integration)
    },
  }

  return proxy
}

// Export for tests
export { ApiError as ApiErrorClass }
