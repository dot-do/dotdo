import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'

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
 *
 * NOT YET IMPLEMENTED - This is a stub for TDD.
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
// Middleware Factory (Stub)
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
export function webhooks(_config?: WebhooksConfig): MiddlewareHandler {
  // TODO: Implement webhooks middleware
  // This is a stub that will cause all tests to fail

  const app = new Hono()

  // Stub route that returns 501 Not Implemented
  app.post('/:source', (c) => {
    return c.json({ error: 'Webhooks middleware not implemented' }, 501)
  })

  return async (c, next) => {
    // Stub: just pass through to next middleware
    // The actual implementation would handle webhook routing
    await next()
  }
}

export default webhooks
