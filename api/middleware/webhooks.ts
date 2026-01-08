import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhooks Middleware
 *
 * Handles incoming webhooks from third-party services.
 * Supports GitHub, Stripe, and other providers.
 *
 * Features:
 * - Signature verification per provider
 * - Event routing by type (github:push, stripe:invoice.paid)
 * - Handler dispatch with parsed payload and Hono context
 * - Provider configuration from integrations.do or env vars
 */

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
  secret: string
  timestampTolerance?: number
}

export type WebhookHandler<T = unknown> = (payload: T, c: Context) => Promise<unknown> | unknown

export interface WebhooksConfig {
  providers?: Record<string, ProviderConfig>
  handlers?: Record<string, WebhookHandler>
  configSource?: 'integrations.do' | 'static'
  fetch?: typeof globalThis.fetch
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STRIPE_TIMESTAMP_TOLERANCE = 300 // 5 minutes in seconds

// Known webhook providers (these are the supported providers)
const KNOWN_PROVIDERS = new Set(['github', 'stripe'])

// Environment variable mapping for provider secrets
const ENV_SECRET_MAPPING: Record<string, string> = {
  github: 'GITHUB_WEBHOOK_SECRET',
  stripe: 'STRIPE_WEBHOOK_SECRET',
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify GitHub webhook signature using SHA256
 */
function verifyGitHubSignature(rawBody: string, signature: string, secret: string): boolean {
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
 * Verify Stripe webhook signature
 * Format: t=timestamp,v1=signature
 */
function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  timestampTolerance: number = DEFAULT_STRIPE_TIMESTAMP_TOLERANCE
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

/**
 * Extract event type based on provider
 */
function extractEventType(source: string, c: Context, payload: unknown): string {
  switch (source) {
    case 'github':
      return c.req.header('X-GitHub-Event') || 'unknown'
    case 'stripe':
      return (payload as { type?: string })?.type || 'unknown'
    default:
      return 'unknown'
  }
}

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
function getProviderSecret(
  source: string,
  providers?: Record<string, ProviderConfig>
): string | undefined {
  // First check explicit config
  if (providers?.[source]?.secret) {
    return providers[source].secret
  }

  // Fall back to environment variable
  const envVar = ENV_SECRET_MAPPING[source]
  if (envVar) {
    const envValue = getEnvVar(envVar)
    if (envValue) {
      return envValue
    }
  }

  return undefined
}

/**
 * Get timestamp tolerance for Stripe
 */
function getTimestampTolerance(
  source: string,
  providers?: Record<string, ProviderConfig>
): number {
  if (source === 'stripe' && providers?.[source]?.timestampTolerance !== undefined) {
    return providers[source].timestampTolerance
  }
  return DEFAULT_STRIPE_TIMESTAMP_TOLERANCE
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

    if (method !== 'POST') {
      return c.json({ error: 'Method not allowed' }, 405)
    }

    const source = c.req.param('source')

    // Validate source name (security check)
    if (!source || !/^[a-z0-9_-]+$/i.test(source)) {
      return c.json({ error: 'Unknown provider' }, 404)
    }

    // Check if this is a known/configured provider
    const isKnownProvider = KNOWN_PROVIDERS.has(source)
    const hasExplicitConfig = config?.providers?.[source] !== undefined

    // If provider is not known and not configured, return 404
    if (!isKnownProvider && !hasExplicitConfig) {
      return c.json({ error: 'Unknown provider' }, 404)
    }

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

    // Verify signature based on provider
    let isValid = false

    switch (source) {
      case 'github': {
        const signature = c.req.header('X-Hub-Signature-256') || ''
        isValid = verifyGitHubSignature(rawBody, signature, secret)
        break
      }
      case 'stripe': {
        const signature = c.req.header('Stripe-Signature') || ''
        const tolerance = getTimestampTolerance(source, config?.providers)
        isValid = verifyStripeSignature(rawBody, signature, secret, tolerance)
        break
      }
      default:
        return c.json({ error: 'Unknown provider' }, 404)
    }

    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401)
    }

    // Parse payload
    let payload: unknown
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    // Extract event type
    const eventType = extractEventType(source, c, payload)
    const fullEventType = `${source}:${eventType}`

    // Find and call handler
    const handler = config?.handlers?.[fullEventType]

    if (handler) {
      try {
        const result = await handler(payload, c)
        // If handler returns a Response, use it
        if (result instanceof Response) {
          return result
        }
        // If handler explicitly returns something with status, honor it
        if (result && typeof result === 'object' && 'status' in result) {
          return c.json(result as object, (result as { status?: number }).status || 200)
        }
      } catch {
        return c.json({ error: 'Internal server error' }, 500)
      }
    }

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
