import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhooks Middleware
 *
 * Handles incoming webhooks from third-party services.
 * Supports GitHub, Stripe, and other providers via extensible registry.
 *
 * Features:
 * - Signature verification per provider (extensible via registry)
 * - Event routing by type (github:push, stripe:invoice.paid)
 * - Handler dispatch with parsed payload and Hono context
 * - Provider configuration from integrations.do or env vars
 * - Payload validation per provider
 * - Metrics/telemetry hooks
 * - Secret rotation support (multiple secrets per provider)
 * - Webhook replay/retry mechanism
 */

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
  secret: string
  /** Additional secrets for rotation - webhook will verify against all */
  rotatedSecrets?: string[]
  timestampTolerance?: number
}

export type WebhookHandler<T = unknown> = (payload: T, c: Context) => Promise<unknown> | unknown

/** Payload validator function - returns true if valid, error message if invalid */
export type PayloadValidator<T = unknown> = (payload: T) => true | string

/** Telemetry/metrics event types */
export type TelemetryEventType =
  | 'webhook.received'
  | 'webhook.signature_verified'
  | 'webhook.signature_failed'
  | 'webhook.payload_validated'
  | 'webhook.payload_invalid'
  | 'webhook.handler_called'
  | 'webhook.handler_succeeded'
  | 'webhook.handler_failed'
  | 'webhook.completed'

/** Telemetry event data */
export interface TelemetryEvent {
  type: TelemetryEventType
  provider: string
  eventType: string
  timestamp: number
  duration?: number
  error?: string
  metadata?: Record<string, unknown>
}

/** Telemetry hook function */
export type TelemetryHook = (event: TelemetryEvent) => void | Promise<void>

/** Retry configuration for failed webhooks */
export interface RetryConfig {
  maxRetries: number
  backoffMs: number
  backoffMultiplier: number
}

/** Webhook replay/retry storage interface */
export interface WebhookReplayStorage {
  /** Store a failed webhook for later retry */
  store(webhook: FailedWebhook): Promise<void>
  /** Retrieve failed webhooks for retry */
  retrieve(provider: string, limit?: number): Promise<FailedWebhook[]>
  /** Mark a webhook as successfully processed */
  markProcessed(id: string): Promise<void>
  /** Mark a webhook as permanently failed */
  markFailed(id: string, reason: string): Promise<void>
}

/** Failed webhook data */
export interface FailedWebhook {
  id: string
  provider: string
  eventType: string
  payload: unknown
  rawBody: string
  headers: Record<string, string>
  error: string
  retryCount: number
  createdAt: number
  lastRetryAt?: number
}

export interface WebhooksConfig {
  providers?: Record<string, ProviderConfig>
  handlers?: Record<string, WebhookHandler>
  /** Payload validators per event type (e.g., 'github:push', 'stripe:invoice.paid') */
  validators?: Record<string, PayloadValidator>
  /** Telemetry hooks for metrics/observability */
  telemetry?: TelemetryHook | TelemetryHook[]
  /** Retry configuration for failed handler executions */
  retry?: RetryConfig
  /** Storage for webhook replay/retry mechanism */
  replayStorage?: WebhookReplayStorage
  configSource?: 'integrations.do' | 'static'
  fetch?: typeof globalThis.fetch
}

// ============================================================================
// Provider Registry
// ============================================================================

/**
 * Provider handler interface for signature verification and event extraction.
 * Implement this interface to add support for new webhook providers.
 */
export interface WebhookProvider {
  /** Provider name (e.g., 'github', 'stripe') */
  name: string
  /** Environment variable name for the webhook secret */
  envSecretKey: string
  /** Header name containing the signature */
  signatureHeader: string
  /** Verify the webhook signature */
  verifySignature(rawBody: string, signature: string, secret: string, config?: ProviderConfig): boolean
  /** Extract the event type from the request */
  extractEventType(c: Context, payload: unknown): string
  /** Optional: Validate the payload structure */
  validatePayload?(payload: unknown): true | string
}

/**
 * Provider registry for managing webhook provider handlers.
 * Allows extending the middleware with new providers.
 */
class ProviderRegistry {
  private providers = new Map<string, WebhookProvider>()

  /** Register a new provider handler */
  register(provider: WebhookProvider): void {
    this.providers.set(provider.name, provider)
  }

  /** Get a provider handler by name */
  get(name: string): WebhookProvider | undefined {
    return this.providers.get(name)
  }

  /** Check if a provider is registered */
  has(name: string): boolean {
    return this.providers.has(name)
  }

  /** Get all registered provider names */
  names(): string[] {
    return Array.from(this.providers.keys())
  }

  /** Get the env var key for a provider's secret */
  getEnvSecretKey(name: string): string | undefined {
    return this.providers.get(name)?.envSecretKey
  }
}

// ============================================================================
// Built-in Provider Implementations
// ============================================================================

/**
 * GitHub webhook provider implementation.
 * Verifies signatures using SHA256 HMAC.
 */
const githubProvider: WebhookProvider = {
  name: 'github',
  envSecretKey: 'GITHUB_WEBHOOK_SECRET',
  signatureHeader: 'X-Hub-Signature-256',

  verifySignature(rawBody: string, signature: string, secret: string, config?: ProviderConfig): boolean {
    // Try primary secret first
    if (verifyGitHubSignatureInternal(rawBody, signature, secret)) {
      return true
    }

    // Try rotated secrets if available
    if (config?.rotatedSecrets) {
      for (const rotatedSecret of config.rotatedSecrets) {
        if (verifyGitHubSignatureInternal(rawBody, signature, rotatedSecret)) {
          return true
        }
      }
    }

    return false
  },

  extractEventType(c: Context): string {
    return c.req.header('X-GitHub-Event') || 'unknown'
  },

  validatePayload(payload: unknown): true | string {
    if (!payload || typeof payload !== 'object') {
      return 'Payload must be an object'
    }
    return true
  },
}

/**
 * Internal GitHub signature verification.
 */
function verifyGitHubSignatureInternal(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false
  }

  const signatureHash = signature.slice(7) // Remove 'sha256=' prefix
  const hmac = createHmac('sha256', secret)
  hmac.update(rawBody)
  const expectedHash = hmac.digest('hex')

  try {
    const sigBuffer = Buffer.from(signatureHash, 'hex')
    const expectedBuffer = Buffer.from(expectedHash, 'hex')

    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

/**
 * Stripe webhook provider implementation.
 * Verifies signatures with timestamp-based replay protection.
 */
const stripeProvider: WebhookProvider = {
  name: 'stripe',
  envSecretKey: 'STRIPE_WEBHOOK_SECRET',
  signatureHeader: 'Stripe-Signature',

  verifySignature(rawBody: string, signature: string, secret: string, config?: ProviderConfig): boolean {
    const tolerance = config?.timestampTolerance ?? DEFAULT_STRIPE_TIMESTAMP_TOLERANCE

    // Try primary secret first
    if (verifyStripeSignatureInternal(rawBody, signature, secret, tolerance)) {
      return true
    }

    // Try rotated secrets if available
    if (config?.rotatedSecrets) {
      for (const rotatedSecret of config.rotatedSecrets) {
        if (verifyStripeSignatureInternal(rawBody, signature, rotatedSecret, tolerance)) {
          return true
        }
      }
    }

    return false
  },

  extractEventType(_c: Context, payload: unknown): string {
    return (payload as { type?: string })?.type || 'unknown'
  },

  validatePayload(payload: unknown): true | string {
    if (!payload || typeof payload !== 'object') {
      return 'Payload must be an object'
    }
    const p = payload as Record<string, unknown>
    if (typeof p.type !== 'string') {
      return 'Payload must have a type field'
    }
    if (!p.data || typeof p.data !== 'object') {
      return 'Payload must have a data object'
    }
    return true
  },
}

/**
 * Internal Stripe signature verification.
 */
function verifyStripeSignatureInternal(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  timestampTolerance: number
): boolean {
  if (!signatureHeader) {
    return false
  }

  // Parse signature header
  const parts: Record<string, string> = {}
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=')
    if (key && value) {
      parts[key] = value
    }
  }

  const timestamp = parts['t']
  const signature = parts['v1']

  if (!timestamp || !signature) {
    return false
  }

  // Check timestamp is recent (prevent replay attacks)
  const timestampNum = parseInt(timestamp, 10)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestampNum) > timestampTolerance) {
    return false
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${rawBody}`
  const hmac = createHmac('sha256', secret)
  hmac.update(signedPayload)
  const expectedSignature = hmac.digest('hex')

  try {
    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expectedSignature, 'hex')

    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

// ============================================================================
// Global Provider Registry
// ============================================================================

/** Global provider registry with built-in providers */
export const providerRegistry = new ProviderRegistry()

// Register built-in providers
providerRegistry.register(githubProvider)
providerRegistry.register(stripeProvider)

/**
 * Register a custom webhook provider.
 * Use this to add support for additional webhook sources.
 *
 * @example
 * ```typescript
 * registerProvider({
 *   name: 'slack',
 *   envSecretKey: 'SLACK_SIGNING_SECRET',
 *   signatureHeader: 'X-Slack-Signature',
 *   verifySignature(rawBody, signature, secret) { ... },
 *   extractEventType(c, payload) { ... },
 * })
 * ```
 */
export function registerProvider(provider: WebhookProvider): void {
  providerRegistry.register(provider)
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STRIPE_TIMESTAMP_TOLERANCE = 300 // 5 minutes in seconds

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get env var value, checking multiple sources for Workers compatibility
 *
 * In vitest-pool-workers, the test code and worker code may have separate
 * `process.env` objects due to bundler module isolation. We check multiple
 * sources to support both production and test environments.
 */
function getEnvVar(name: string): string | undefined {
  // Check shared test env first (for vitest-pool-workers compatibility)
  // Tests can use setTestEnv() to set env vars visible to the middleware
  const sharedEnv = (globalThis as { __WEBHOOKS_TEST_ENV__?: Record<string, string> }).__WEBHOOKS_TEST_ENV__
  if (sharedEnv?.[name]) {
    return sharedEnv[name]
  }

  // Check process.env (Node.js style / production)
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name]
  }

  return undefined
}

/**
 * Get secret for a provider from config or environment
 */
function getProviderSecret(source: string, providers?: Record<string, ProviderConfig>): string | undefined {
  // First check explicit config
  if (providers?.[source]?.secret) {
    return providers[source].secret
  }

  // Fall back to environment variable using registry
  const envVar = providerRegistry.getEnvSecretKey(source)
  if (envVar) {
    const envValue = getEnvVar(envVar)
    if (envValue) {
      return envValue
    }
  }

  return undefined
}

/**
 * Emit telemetry events to configured hooks
 */
async function emitTelemetry(
  hooks: TelemetryHook | TelemetryHook[] | undefined,
  event: TelemetryEvent
): Promise<void> {
  if (!hooks) return

  const hookArray = Array.isArray(hooks) ? hooks : [hooks]
  await Promise.all(hookArray.map((hook) => hook(event)))
}

/**
 * Generate a unique webhook ID for replay tracking
 */
function generateWebhookId(): string {
  return `wh_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Creates a webhooks middleware for handling incoming webhooks.
 *
 * @param config - Webhook configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * app.use('/api/webhooks/*', webhooks({
 *   handlers: {
 *     'github:push': async (payload, c) => { ... },
 *     'stripe:invoice.paid': async (payload, c) => { ... },
 *   },
 * }))
 * ```
 *
 * @example With telemetry
 * ```typescript
 * app.use('/api/webhooks/*', webhooks({
 *   handlers: { ... },
 *   telemetry: (event) => {
 *     console.log(`[${event.type}] ${event.provider}:${event.eventType}`)
 *   },
 * }))
 * ```
 *
 * @example With secret rotation
 * ```typescript
 * app.use('/api/webhooks/*', webhooks({
 *   providers: {
 *     github: {
 *       secret: 'new-secret',
 *       rotatedSecrets: ['old-secret-1', 'old-secret-2'],
 *     },
 *   },
 *   handlers: { ... },
 * }))
 * ```
 */
export function webhooks(config?: WebhooksConfig): MiddlewareHandler {
  // Cache for integrations.do config
  let integrationsConfig: Record<string, { webhookSecret: string }> | null = null
  let configFetchPromise: Promise<void> | null = null

  // Fetch config from integrations.do if configured
  async function fetchIntegrationsConfig(): Promise<void> {
    if (config?.configSource !== 'integrations.do' || !config.fetch) {
      return
    }

    if (integrationsConfig !== null) {
      return // Already fetched
    }

    if (configFetchPromise) {
      await configFetchPromise
      return
    }

    configFetchPromise = (async () => {
      try {
        const response = await config.fetch!('/api/integrations')
        if (response.ok) {
          integrationsConfig = await response.json()
        }
      } catch {
        // Fall back to static config on error
        integrationsConfig = {}
      }
    })()

    await configFetchPromise
  }

  // Get secret, checking integrations.do cache first
  function getSecret(source: string): string | undefined {
    // Check integrations.do config first
    if (integrationsConfig?.[source]?.webhookSecret) {
      return integrationsConfig[source].webhookSecret
    }

    // Fall back to static config / env vars
    return getProviderSecret(source, config?.providers)
  }

  const app = new Hono()

  // Handle non-POST methods
  app.all('/:source', async (c) => {
    const method = c.req.method
    const startTime = Date.now()
    const source = c.req.param('source')

    if (method !== 'POST') {
      return c.json({ error: 'Method not allowed' }, 405)
    }

    // Validate source name (security check)
    if (!source || !/^[a-z0-9_-]+$/i.test(source)) {
      return c.json({ error: 'Unknown provider' }, 404)
    }

    // Check if this is a known/configured provider using registry
    const provider = providerRegistry.get(source)
    const hasExplicitConfig = config?.providers?.[source] !== undefined

    // If provider is not registered and not configured, return 404
    if (!provider && !hasExplicitConfig) {
      return c.json({ error: 'Unknown provider' }, 404)
    }

    // For configured but unregistered providers, we can't verify - return 404
    if (!provider) {
      return c.json({ error: 'Unknown provider' }, 404)
    }

    // Emit telemetry: webhook received
    await emitTelemetry(config?.telemetry, {
      type: 'webhook.received',
      provider: source,
      eventType: 'pending',
      timestamp: startTime,
    })

    // Fetch integrations.do config if configured
    await fetchIntegrationsConfig()

    // Get provider secret
    const secret = getSecret(source)

    if (!secret) {
      // No secret configured - return 401 (can't verify signature)
      return c.json({ error: 'Missing signature configuration' }, 401)
    }

    // Get raw body for signature verification
    const rawBody = await c.req.text()

    // Handle empty body
    if (!rawBody || rawBody.trim() === '') {
      return c.json({ error: 'Empty body' }, 400)
    }

    // Get signature from provider-specific header
    const signature = c.req.header(provider.signatureHeader) || ''

    // Get provider config for rotation support
    const providerConfig = config?.providers?.[source]

    // Verify signature using provider's implementation
    const isValid = provider.verifySignature(rawBody, signature, secret, providerConfig)

    if (!isValid) {
      await emitTelemetry(config?.telemetry, {
        type: 'webhook.signature_failed',
        provider: source,
        eventType: 'unknown',
        timestamp: Date.now(),
      })
      return c.json({ error: 'Invalid signature' }, 401)
    }

    await emitTelemetry(config?.telemetry, {
      type: 'webhook.signature_verified',
      provider: source,
      eventType: 'pending',
      timestamp: Date.now(),
    })

    // Parse payload
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    // Extract event type using provider's implementation
    const eventType = provider.extractEventType(c, payload)
    const fullEventType = `${source}:${eventType}`

    // Run payload validation if configured
    const validator = config?.validators?.[fullEventType]
    if (validator) {
      const validationResult = validator(payload)
      if (validationResult !== true) {
        await emitTelemetry(config?.telemetry, {
          type: 'webhook.payload_invalid',
          provider: source,
          eventType: fullEventType,
          timestamp: Date.now(),
          error: validationResult,
        })
        return c.json({ error: `Payload validation failed: ${validationResult}` }, 400)
      }
      await emitTelemetry(config?.telemetry, {
        type: 'webhook.payload_validated',
        provider: source,
        eventType: fullEventType,
        timestamp: Date.now(),
      })
    }

    // Find and call handler
    const handler = config?.handlers?.[fullEventType]

    if (handler) {
      await emitTelemetry(config?.telemetry, {
        type: 'webhook.handler_called',
        provider: source,
        eventType: fullEventType,
        timestamp: Date.now(),
      })

      try {
        const result = await handler(payload, c)

        await emitTelemetry(config?.telemetry, {
          type: 'webhook.handler_succeeded',
          provider: source,
          eventType: fullEventType,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
        })

        // If handler returns a Response, use it
        if (result instanceof Response) {
          return result
        }
        // If handler explicitly returns something with status, honor it
        if (result && typeof result === 'object' && 'status' in result) {
          return c.json(result as object, (result as { status?: number }).status || 200)
        }
      } catch (error) {
        await emitTelemetry(config?.telemetry, {
          type: 'webhook.handler_failed',
          provider: source,
          eventType: fullEventType,
          timestamp: Date.now(),
          duration: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error',
        })

        // Store for retry if replay storage is configured
        if (config?.replayStorage) {
          const headers: Record<string, string> = {}
          c.req.raw.headers.forEach((value, key) => {
            headers[key] = value
          })

          await config.replayStorage.store({
            id: generateWebhookId(),
            provider: source,
            eventType: fullEventType,
            payload,
            rawBody,
            headers,
            error: error instanceof Error ? error.message : 'Unknown error',
            retryCount: 0,
            createdAt: Date.now(),
          })
        }

        return c.json({ error: 'Internal server error' }, 500)
      }
    }

    // Emit completion telemetry
    await emitTelemetry(config?.telemetry, {
      type: 'webhook.completed',
      provider: source,
      eventType: fullEventType,
      timestamp: Date.now(),
      duration: Date.now() - startTime,
    })

    // Default response
    return c.json({ received: true, eventType: fullEventType })
  })

  // Return middleware that mounts the webhook app
  return async (c, next) => {
    // Check if this is a webhook route
    const path = new URL(c.req.url).pathname
    const webhooksPath = '/api/webhooks/'

    if (path.startsWith(webhooksPath)) {
      // Extract the relative path for our Hono app
      const relativePath = path.slice('/api/webhooks'.length) || '/'

      // Create a new request with the relative path
      const url = new URL(c.req.url)
      url.pathname = relativePath

      const request = new Request(url.toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: c.req.raw.body,
        // @ts-expect-error - duplex is needed for streaming bodies
        duplex: 'half',
      })

      const response = await app.fetch(request)
      return response
    }

    await next()
  }
}

/**
 * Set a test environment variable that the webhooks middleware can read.
 *
 * In vitest-pool-workers, process.env is isolated between test code and middleware.
 * Use this function in tests to set env vars that the middleware should see.
 *
 * @example
 * ```typescript
 * import { setTestEnv, clearTestEnv } from './webhooks'
 *
 * beforeEach(() => {
 *   setTestEnv('GITHUB_WEBHOOK_SECRET', 'test-secret')
 * })
 *
 * afterEach(() => {
 *   clearTestEnv()
 * })
 * ```
 */
export function setTestEnv(name: string, value: string): void {
  const sharedEnv =
    (globalThis as { __WEBHOOKS_TEST_ENV__?: Record<string, string | undefined> }).__WEBHOOKS_TEST_ENV__ ||
    ((globalThis as { __WEBHOOKS_TEST_ENV__?: Record<string, string | undefined> }).__WEBHOOKS_TEST_ENV__ = {})
  sharedEnv[name] = value
}

/**
 * Clear a test environment variable.
 */
export function clearTestEnv(name?: string): void {
  const sharedEnv = (globalThis as { __WEBHOOKS_TEST_ENV__?: Record<string, string | undefined> }).__WEBHOOKS_TEST_ENV__
  if (sharedEnv) {
    if (name) {
      delete sharedEnv[name]
    } else {
      // Clear all custom values but keep vitest's values
      for (const key of Object.keys(sharedEnv)) {
        if (!key.startsWith('VITEST') && !key.startsWith('__VITEST')) {
          delete sharedEnv[key]
        }
      }
    }
  }
}

export default webhooks
