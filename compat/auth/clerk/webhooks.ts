/**
 * @dotdo/clerk - Webhook Signature Verification
 *
 * Clerk uses Svix for webhooks. This module provides signature verification
 * compatible with Clerk's webhook format.
 *
 * @example Basic Verification
 * ```typescript
 * import { Webhook } from '@dotdo/clerk'
 *
 * const wh = new Webhook('whsec_...')
 *
 * // In your webhook handler
 * try {
 *   const payload = wh.verify(body, {
 *     'svix-id': req.headers.get('svix-id'),
 *     'svix-timestamp': req.headers.get('svix-timestamp'),
 *     'svix-signature': req.headers.get('svix-signature'),
 *   })
 *   // Handle verified payload
 * } catch (error) {
 *   // Signature verification failed
 * }
 * ```
 *
 * @example High-Level Handler
 * ```typescript
 * import { createWebhookHandler } from '@dotdo/clerk'
 *
 * const handler = createWebhookHandler('whsec_...')
 *
 * handler
 *   .on('user.created', async (event) => {
 *     await db.users.create({ clerkId: event.data.id })
 *   })
 *   .on('user.deleted', async (event) => {
 *     await db.users.delete({ clerkId: event.data.id })
 *   })
 *   .on('session.created', async (event) => {
 *     await analytics.track('session_start', { userId: event.data.user_id })
 *   })
 *
 * // Use with Cloudflare Workers
 * export default { fetch: handler.createHandler() }
 * ```
 *
 * @example Typed Event Data
 * ```typescript
 * import { createWebhookHandler, type UserCreatedEvent } from '@dotdo/clerk'
 *
 * const handler = createWebhookHandler('whsec_...')
 *
 * handler.on('user.created', (event: UserCreatedEvent) => {
 *   console.log('User email:', event.data.email_addresses[0]?.email_address)
 *   console.log('User metadata:', event.data.public_metadata)
 * })
 * ```
 *
 * @module
 */

import type { ClerkWebhookEvent, ClerkWebhookEventType } from './types'

/**
 * Webhook verification error
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
  }
}

/**
 * Svix webhook headers (Clerk uses Svix for webhooks)
 */
export interface WebhookHeaders {
  'svix-id'?: string | null
  'svix-timestamp'?: string | null
  'svix-signature'?: string | null
}

/**
 * Webhook verification options
 */
export interface WebhookVerifyOptions {
  /** Tolerance for timestamp validation in seconds (default: 300 = 5 minutes) */
  tolerance?: number
}

/**
 * Webhook class for verifying Clerk webhook signatures
 *
 * Clerk webhooks use the Svix signature scheme which consists of:
 * - svix-id: A unique message ID
 * - svix-timestamp: Unix timestamp when the message was sent
 * - svix-signature: HMAC-SHA256 signature(s)
 *
 * The signature is computed as:
 * HMAC-SHA256(secret, `${svix-id}.${svix-timestamp}.${payload}`)
 */
export class Webhook {
  private secretBytes: Uint8Array

  /**
   * Create a new Webhook instance
   * @param secret - Webhook signing secret (with or without 'whsec_' prefix)
   */
  constructor(secret: string) {
    // Clerk/Svix secrets are base64 encoded after the 'whsec_' prefix
    let secretKey = secret
    if (secretKey.startsWith('whsec_')) {
      secretKey = secretKey.slice(6) // Remove 'whsec_' prefix
    }

    // Decode base64 secret
    try {
      this.secretBytes = this.base64Decode(secretKey)
    } catch {
      // If not valid base64, use as raw string
      this.secretBytes = new TextEncoder().encode(secretKey)
    }
  }

  /**
   * Verify a webhook payload and return the parsed event (async version)
   *
   * Note: This method is async because Web Crypto API is async.
   * For Cloudflare Workers and edge environments, this is the recommended method.
   *
   * @param payload - Raw webhook body (string or Buffer)
   * @param headers - Webhook headers containing svix-id, svix-timestamp, svix-signature
   * @param options - Verification options
   * @returns Parsed and verified webhook event
   * @throws WebhookVerificationError if verification fails
   */
  async verify(
    payload: string | Buffer | ArrayBuffer,
    headers: WebhookHeaders | Record<string, string | string[] | undefined>,
    options?: WebhookVerifyOptions
  ): Promise<ClerkWebhookEvent> {
    return this.verifyAsync(payload, headers, options)
  }

  /**
   * Asynchronous signature verification (recommended for Workers)
   */
  async verifyAsync(
    payload: string | Buffer | ArrayBuffer,
    headers: WebhookHeaders | Record<string, string | string[] | undefined>,
    options?: WebhookVerifyOptions
  ): Promise<ClerkWebhookEvent> {
    const payloadString = this.normalizePayload(payload)
    const normalizedHeaders = this.normalizeHeaders(headers)
    const tolerance = options?.tolerance ?? 300

    // Validate required headers
    const msgId = normalizedHeaders['svix-id']
    const msgTimestamp = normalizedHeaders['svix-timestamp']
    const msgSignature = normalizedHeaders['svix-signature']

    if (!msgId) {
      throw new WebhookVerificationError('Missing svix-id header')
    }
    if (!msgTimestamp) {
      throw new WebhookVerificationError('Missing svix-timestamp header')
    }
    if (!msgSignature) {
      throw new WebhookVerificationError('Missing svix-signature header')
    }

    // Validate timestamp
    const timestamp = parseInt(msgTimestamp, 10)
    if (isNaN(timestamp)) {
      throw new WebhookVerificationError('Invalid svix-timestamp header')
    }

    const now = Math.floor(Date.now() / 1000)
    if (timestamp < now - tolerance) {
      throw new WebhookVerificationError('Message timestamp too old')
    }
    if (timestamp > now + tolerance) {
      throw new WebhookVerificationError('Message timestamp too new')
    }

    // Verify signature asynchronously
    const verified = await this.verifySignature(msgId, msgTimestamp, payloadString, msgSignature)
    if (!verified) {
      throw new WebhookVerificationError('Invalid signature')
    }

    // Parse and return the event
    try {
      return JSON.parse(payloadString) as ClerkWebhookEvent
    } catch {
      throw new WebhookVerificationError('Invalid JSON payload')
    }
  }

  /**
   * Generate a signature for testing purposes
   */
  async sign(msgId: string, timestamp: number, payload: string): Promise<string> {
    const toSign = `${msgId}.${timestamp}.${payload}`
    const signature = await this.computeHmac(toSign)
    return `v1,${signature}`
  }

  /**
   * Generate test headers for testing purposes
   */
  async generateTestHeaders(payload: string): Promise<{
    'svix-id': string
    'svix-timestamp': string
    'svix-signature': string
  }> {
    const msgId = `msg_${this.generateId()}`
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = await this.sign(msgId, timestamp, payload)

    return {
      'svix-id': msgId,
      'svix-timestamp': timestamp.toString(),
      'svix-signature': signature,
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private normalizePayload(payload: string | Buffer | ArrayBuffer): string {
    if (typeof payload === 'string') {
      return payload
    }
    if (payload instanceof ArrayBuffer) {
      return new TextDecoder().decode(payload)
    }
    // Buffer (Node.js)
    return payload.toString('utf-8')
  }

  private normalizeHeaders(
    headers: WebhookHeaders | Record<string, string | string[] | undefined>
  ): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {}

    // Handle both object and Headers-like inputs
    const headerEntries = Object.entries(headers)

    for (const [key, value] of headerEntries) {
      const normalizedKey = key.toLowerCase()
      if (Array.isArray(value)) {
        result[normalizedKey] = value[0]
      } else if (value !== null && value !== undefined) {
        result[normalizedKey] = value
      }
    }

    return result
  }

  private async verifySignature(
    msgId: string,
    msgTimestamp: string,
    payload: string,
    signatureHeader: string
  ): Promise<boolean> {
    const toSign = `${msgId}.${msgTimestamp}.${payload}`
    const expectedSignature = await this.computeHmac(toSign)

    // Signature header can contain multiple signatures (v1,xxx v1,yyy)
    const signatures = signatureHeader.split(' ')

    for (const sig of signatures) {
      const [version, signature] = sig.split(',')
      if (version === 'v1' && signature && this.secureCompare(signature, expectedSignature)) {
        return true
      }
    }

    return false
  }

  private async computeHmac(data: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      'raw',
      this.secretBytes.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const dataBytes = new TextEncoder().encode(data)
    const signature = await crypto.subtle.sign('HMAC', key, dataBytes)

    return this.base64Encode(new Uint8Array(signature))
  }

  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false
    }

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  private base64Encode(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  private base64Decode(str: string): Uint8Array {
    const binary = atob(str)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  private generateId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

/**
 * Create a Webhook instance (convenience function)
 */
export function createWebhook(secret: string): Webhook {
  return new Webhook(secret)
}

// ============================================================================
// WEBHOOK EVENT TYPES
// ============================================================================

/**
 * Typed webhook event data by event type
 */
export interface WebhookEventMap {
  'user.created': ClerkWebhookEvent & { type: 'user.created' }
  'user.updated': ClerkWebhookEvent & { type: 'user.updated' }
  'user.deleted': ClerkWebhookEvent & { type: 'user.deleted' }
  'session.created': ClerkWebhookEvent & { type: 'session.created' }
  'session.ended': ClerkWebhookEvent & { type: 'session.ended' }
  'session.removed': ClerkWebhookEvent & { type: 'session.removed' }
  'session.revoked': ClerkWebhookEvent & { type: 'session.revoked' }
  'organization.created': ClerkWebhookEvent & { type: 'organization.created' }
  'organization.updated': ClerkWebhookEvent & { type: 'organization.updated' }
  'organization.deleted': ClerkWebhookEvent & { type: 'organization.deleted' }
  'organizationMembership.created': ClerkWebhookEvent & { type: 'organizationMembership.created' }
  'organizationMembership.updated': ClerkWebhookEvent & { type: 'organizationMembership.updated' }
  'organizationMembership.deleted': ClerkWebhookEvent & { type: 'organizationMembership.deleted' }
  'organizationInvitation.created': ClerkWebhookEvent & { type: 'organizationInvitation.created' }
  'organizationInvitation.accepted': ClerkWebhookEvent & { type: 'organizationInvitation.accepted' }
  'organizationInvitation.revoked': ClerkWebhookEvent & { type: 'organizationInvitation.revoked' }
  'email.created': ClerkWebhookEvent & { type: 'email.created' }
  'sms.created': ClerkWebhookEvent & { type: 'sms.created' }
}

/**
 * Event handler callback type
 */
export type WebhookEventHandler<T extends ClerkWebhookEventType = ClerkWebhookEventType> = (
  event: WebhookEventMap[T]
) => void | Promise<void>

/**
 * WebhookHandler options
 */
export interface WebhookHandlerOptions {
  /** Tolerance for timestamp validation in seconds (default: 300 = 5 minutes) */
  tolerance?: number
}

// ============================================================================
// WEBHOOK HANDLER CLASS
// ============================================================================

/**
 * WebhookHandler provides a higher-level API for handling Clerk webhooks.
 *
 * It combines signature verification with event routing, allowing you to
 * register handlers for specific event types.
 *
 * @example
 * ```typescript
 * import { WebhookHandler, createWebhookHandler } from '@dotdo/clerk'
 *
 * const handler = createWebhookHandler('whsec_...')
 *
 * handler.on('user.created', async (event) => {
 *   console.log('User created:', event.data.id)
 * })
 *
 * handler.on('session.created', async (event) => {
 *   console.log('Session created:', event.data.id)
 * })
 *
 * // Use with Cloudflare Workers
 * export default {
 *   fetch: handler.createHandler()
 * }
 *
 * // Or handle manually
 * const event = await handler.handleRequest(request)
 * ```
 */
export class WebhookHandler {
  private webhook: Webhook
  private options: WebhookHandlerOptions
  private handlers: Map<ClerkWebhookEventType, Set<WebhookEventHandler<ClerkWebhookEventType>>>
  private allHandlers: Set<WebhookEventHandler<ClerkWebhookEventType>>

  /**
   * Create a new WebhookHandler
   * @param secret - Webhook signing secret (with or without 'whsec_' prefix)
   * @param options - Handler options
   */
  constructor(secret: string, options?: WebhookHandlerOptions) {
    this.webhook = new Webhook(secret)
    this.options = options ?? {}
    this.handlers = new Map()
    this.allHandlers = new Set()
  }

  /**
   * Register a handler for a specific event type
   *
   * @param eventType - The event type to handle
   * @param handler - The handler function
   * @returns This handler instance for chaining
   *
   * @example
   * ```typescript
   * handler.on('user.created', (event) => {
   *   console.log('New user:', event.data)
   * })
   * ```
   */
  on<T extends ClerkWebhookEventType>(eventType: T, handler: WebhookEventHandler<T>): this {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
    }
    this.handlers.get(eventType)!.add(handler as WebhookEventHandler<ClerkWebhookEventType>)
    return this
  }

  /**
   * Remove a handler for a specific event type
   *
   * @param eventType - The event type
   * @param handler - The handler to remove
   * @returns This handler instance for chaining
   */
  off<T extends ClerkWebhookEventType>(eventType: T, handler: WebhookEventHandler<T>): this {
    const handlers = this.handlers.get(eventType)
    if (handlers) {
      handlers.delete(handler as WebhookEventHandler<ClerkWebhookEventType>)
    }
    return this
  }

  /**
   * Register a handler for all event types
   *
   * @param handler - The handler function
   * @returns This handler instance for chaining
   *
   * @example
   * ```typescript
   * handler.onAll((event) => {
   *   console.log('Received event:', event.type)
   * })
   * ```
   */
  onAll(handler: WebhookEventHandler<ClerkWebhookEventType>): this {
    this.allHandlers.add(handler)
    return this
  }

  /**
   * Handle an incoming webhook request
   *
   * Verifies the signature and dispatches to registered handlers.
   *
   * @param payloadOrRequest - The raw webhook body or a Request object
   * @param headers - Webhook headers (optional if using Request object)
   * @returns The verified webhook event
   * @throws WebhookVerificationError if signature verification fails
   *
   * @example
   * ```typescript
   * // With raw payload and headers
   * const event = await handler.handleRequest(body, {
   *   'svix-id': req.headers.get('svix-id'),
   *   'svix-timestamp': req.headers.get('svix-timestamp'),
   *   'svix-signature': req.headers.get('svix-signature'),
   * })
   *
   * // With Request object
   * const event = await handler.handleRequest(request)
   * ```
   */
  async handleRequest(
    payloadOrRequest: string | Buffer | ArrayBuffer | Request,
    headers?: WebhookHeaders | Record<string, string | string[] | undefined>
  ): Promise<ClerkWebhookEvent> {
    let payload: string | ArrayBuffer
    let webhookHeaders: WebhookHeaders | Record<string, string | string[] | undefined>

    // Handle Request object
    if (payloadOrRequest instanceof Request) {
      payload = await payloadOrRequest.text()
      webhookHeaders = this.extractHeaders(payloadOrRequest.headers)
    } else {
      payload = payloadOrRequest as string | ArrayBuffer
      webhookHeaders = headers!
    }

    // Verify the webhook
    const event = await this.webhook.verify(payload, webhookHeaders, {
      tolerance: this.options.tolerance,
    })

    // Dispatch to handlers
    await this.dispatch(event)

    return event
  }

  /**
   * Create a fetch handler for use with Cloudflare Workers or similar platforms
   *
   * @returns A fetch handler function
   *
   * @example
   * ```typescript
   * // Use as Workers handler
   * export default {
   *   fetch: handler.createHandler()
   * }
   *
   * // Or in Hono/Express-like frameworks
   * app.post('/webhook', handler.createHandler())
   * ```
   */
  createHandler(): (request: Request) => Promise<Response> {
    return async (request: Request): Promise<Response> => {
      // Only accept POST requests
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      try {
        const event = await this.handleRequest(request)

        return new Response(
          JSON.stringify({
            success: true,
            type: event.type,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      } catch (error) {
        if (error instanceof WebhookVerificationError) {
          return new Response(
            JSON.stringify({
              error: error.message,
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        }

        // Handler error
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Internal server error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract headers from a Headers object
   */
  private extractHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {}

    // Extract svix headers
    const svixId = headers.get('svix-id')
    const svixTimestamp = headers.get('svix-timestamp')
    const svixSignature = headers.get('svix-signature')

    if (svixId) result['svix-id'] = svixId
    if (svixTimestamp) result['svix-timestamp'] = svixTimestamp
    if (svixSignature) result['svix-signature'] = svixSignature

    return result
  }

  /**
   * Dispatch an event to registered handlers
   */
  private async dispatch(event: ClerkWebhookEvent): Promise<void> {
    const promises: Promise<void>[] = []

    // Call type-specific handlers
    const typeHandlers = this.handlers.get(event.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        const result = handler(event as WebhookEventMap[typeof event.type])
        if (result instanceof Promise) {
          promises.push(result)
        }
      }
    }

    // Call all-event handlers
    for (const handler of this.allHandlers) {
      const result = handler(event as WebhookEventMap[typeof event.type])
      if (result instanceof Promise) {
        promises.push(result)
      }
    }

    // Wait for all async handlers
    await Promise.all(promises)
  }
}

/**
 * Create a WebhookHandler instance (convenience function)
 *
 * @param secret - Webhook signing secret
 * @param options - Handler options
 * @returns A new WebhookHandler instance
 *
 * @example
 * ```typescript
 * const handler = createWebhookHandler('whsec_...')
 *
 * handler
 *   .on('user.created', handleUserCreated)
 *   .on('user.deleted', handleUserDeleted)
 *   .on('session.created', handleSessionCreated)
 * ```
 */
export function createWebhookHandler(secret: string, options?: WebhookHandlerOptions): WebhookHandler {
  return new WebhookHandler(secret, options)
}
