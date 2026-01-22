/**
 * @module rpc.do/auth/auth-transport
 *
 * Authenticated transport wrapper for rpc.do.
 *
 * This module provides the {@link AuthTransport} class, which wraps any
 * transport to add OAuth authentication headers. It automatically:
 *
 * - Attaches `Authorization: Bearer <token>` headers to requests
 * - Proactively refreshes tokens that are about to expire
 * - Retries requests on 401 responses with fresh tokens
 *
 * @example Decorator pattern (recommended)
 * ```typescript
 * import { createClient, AuthTransport, FetchTransport, TokenStore, createRefreshFn } from 'rpc.do'
 *
 * // Create base transport
 * const baseTransport = new FetchTransport({ url: 'https://api.example.com' })
 *
 * // Wrap with auth
 * const transport = new AuthTransport({
 *   transport: baseTransport,  // Wrap existing transport
 *   tokenStore: new TokenStore(),
 *   onRefreshToken: createRefreshFn({
 *     clientId: 'my-app',
 *     oauthBaseUrl: 'https://oauth.do',
 *   }),
 * })
 *
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 * // Requests are automatically authenticated!
 * ```
 *
 * @example Legacy URL-based API (deprecated)
 * ```typescript
 * // Still works for backward compatibility
 * const transport = new AuthTransport({
 *   url: 'https://api.example.com',  // Creates FetchTransport internally
 *   tokenStore: new TokenStore(),
 * })
 * ```
 */

import type { RPCMessage, RPCResponse } from '../types'
import type { Transport, TransportState } from '../transport/types'
import { FetchTransport, generateCorrelationId, CORRELATION_ID_HEADER } from '../transport/fetch'
import type { ITokenStore } from './token-store'

/**
 * Token refresh function signature
 */
export type RefreshTokenFn = (refreshToken: string) => Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
}>

/**
 * Extended RPC message with optional headers
 */
export interface RPCMessageWithHeaders extends RPCMessage {
  /** Optional headers to include in the request */
  headers?: Record<string, string>
}

/**
 * Options for AuthTransport
 */
export interface AuthTransportOptions {
  /**
   * Wrapped transport (preferred - decorator pattern)
   *
   * When provided, AuthTransport wraps this transport and adds auth headers
   * to all messages before delegating.
   *
   * @example
   * ```typescript
   * const baseTransport = new FetchTransport({ url: 'https://api.example.com' })
   * const authTransport = new AuthTransport({
   *   transport: baseTransport,
   *   tokenStore: new TokenStore(),
   * })
   * ```
   */
  transport?: Transport
  /**
   * Base URL of the RPC endpoint
   * @deprecated Use `transport` option instead for better composition.
   * This option creates a FetchTransport internally.
   */
  url?: string
  /** Token store for reading/writing tokens */
  tokenStore: ITokenStore
  /** Function to refresh expired tokens */
  onRefreshToken?: RefreshTokenFn
  /** Request timeout in milliseconds (default: 30000) - only used when url is provided */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
  /** Custom fetch implementation (for testing) - only used when url is provided */
  fetch?: typeof globalThis.fetch
}

/**
 * Auth Transport - adds OAuth authentication to RPC requests (Decorator pattern)
 *
 * This transport wrapper:
 * 1. Wraps an existing transport (decorator pattern)
 * 2. Attaches Authorization header when a valid token is available
 * 3. Proactively refreshes tokens that are about to expire
 * 4. Automatically retries requests on 401 with fresh tokens
 *
 * @example Decorator pattern (recommended)
 * ```typescript
 * const baseTransport = new FetchTransport({ url: 'https://api.example.com' })
 * const transport = new AuthTransport({
 *   transport: baseTransport,
 *   tokenStore: new TokenStore(),
 *   onRefreshToken: async (refreshToken) => {
 *     return refreshToken({ refreshToken, clientId: 'my-app', oauthBaseUrl: 'https://oauth.do' })
 *   },
 * })
 *
 * const client = createClient({ transport })
 * ```
 */
export class AuthTransport implements Transport {
  private readonly innerTransport: Transport
  private readonly tokenStore: ITokenStore
  private readonly onRefreshToken?: RefreshTokenFn
  private readonly baseCorrelationId?: string
  private isRefreshing: boolean = false

  constructor(options: AuthTransportOptions) {
    // Decorator pattern: prefer wrapped transport over URL
    if (options.transport) {
      this.innerTransport = options.transport
    } else if (options.url) {
      // Backward compatibility: create FetchTransport internally
      // Build options conditionally to satisfy exactOptionalPropertyTypes
      this.innerTransport = new FetchTransport(
        Object.assign(
          { url: options.url },
          options.timeout !== undefined && { timeout: options.timeout },
          options.correlationId !== undefined && { correlationId: options.correlationId },
          options.fetch !== undefined && { fetch: options.fetch }
        )
      )
    } else {
      throw new Error('AuthTransport requires either transport or url option')
    }

    this.tokenStore = options.tokenStore
    if (options.onRefreshToken !== undefined) {
      this.onRefreshToken = options.onRefreshToken
    }
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
  }

  /**
   * Send an RPC message with authentication
   *
   * Augments the message with auth headers and delegates to the wrapped transport.
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

    // Check for token expiry and refresh if needed (before the request)
    await this.ensureFreshToken()

    // Get current token
    const tokens = await this.tokenStore.getTokens()

    // Augment message with auth header
    const authMessage = this.augmentMessageWithAuth(message, tokens?.access_token, correlationId)

    // Delegate to inner transport
    const response = await this.innerTransport.send<T>(authMessage)

    // Handle 401 - try to refresh and retry
    if (response.error?.httpStatus === 401 && tokens?.refresh_token && this.onRefreshToken) {
      const refreshed = await this.tryRefreshToken(tokens.refresh_token)
      if (refreshed) {
        // Retry with new token
        return this.retryWithFreshToken<T>(message, correlationId)
      }
    }

    return response
  }

  /**
   * Augment an RPC message with authentication headers
   */
  private augmentMessageWithAuth(
    message: RPCMessage,
    accessToken: string | undefined,
    correlationId: string
  ): RPCMessageWithHeaders {
    const existingHeaders = (message as RPCMessageWithHeaders).headers ?? {}

    const authMessage: RPCMessageWithHeaders = {
      ...message,
      correlationId,
      headers: {
        ...existingHeaders,
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
    }

    return authMessage
  }

  /**
   * Ensure we have a fresh (non-expired) token
   * Proactively refreshes if token is about to expire
   */
  private async ensureFreshToken(): Promise<void> {
    if (!this.onRefreshToken) {
      return
    }

    const isExpired = await this.tokenStore.isTokenExpired()
    if (!isExpired) {
      return
    }

    const tokens = await this.tokenStore.getTokens()
    if (tokens?.refresh_token) {
      await this.tryRefreshToken(tokens.refresh_token)
    }
  }

  /**
   * Try to refresh the token
   * Returns true if refresh was successful
   */
  private async tryRefreshToken(refreshToken: string): Promise<boolean> {
    if (this.isRefreshing || !this.onRefreshToken) {
      return false
    }

    this.isRefreshing = true
    try {
      const newTokens = await this.onRefreshToken(refreshToken)
      await this.tokenStore.saveTokens({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token ?? refreshToken,
        expires_at: Date.now() + newTokens.expires_in * 1000,
      })
      return true
    } catch {
      return false
    } finally {
      this.isRefreshing = false
    }
  }

  /**
   * Retry the request with a fresh token
   */
  private async retryWithFreshToken<T>(
    message: RPCMessage,
    correlationId: string
  ): Promise<RPCResponse<T>> {
    const tokens = await this.tokenStore.getTokens()

    // Augment message with new token
    const authMessage = this.augmentMessageWithAuth(message, tokens?.access_token, correlationId)

    // Delegate to inner transport
    return this.innerTransport.send<T>(authMessage)
  }

  /**
   * Close the transport
   *
   * Delegates to the wrapped transport if it supports close.
   */
  async close(): Promise<void> {
    if (this.innerTransport.close) {
      await this.innerTransport.close()
    }
  }

  /**
   * Get the transport state
   *
   * Delegates to the wrapped transport if it supports getState,
   * otherwise returns CONNECTED.
   */
  getState(): TransportState {
    if (this.innerTransport.getState) {
      return this.innerTransport.getState()
    }
    return 'CONNECTED' as TransportState
  }
}

/**
 * Create an auth transport (convenience factory function).
 *
 * This is a convenience wrapper around `new AuthTransport(options)` for
 * functional programming styles or dependency injection.
 *
 * @param options - Configuration options for the transport
 * @returns A new AuthTransport instance
 *
 * @example Decorator pattern (recommended)
 * ```typescript
 * import { createAuthTransport, createFetchTransport, createClient, TokenStore, createRefreshFn } from 'rpc.do'
 *
 * const baseTransport = createFetchTransport({ url: 'https://api.example.com' })
 * const transport = createAuthTransport({
 *   transport: baseTransport,
 *   tokenStore: new TokenStore(),
 *   onRefreshToken: createRefreshFn({
 *     clientId: 'my-app',
 *     oauthBaseUrl: 'https://oauth.do',
 *   }),
 * })
 *
 * const client = createClient<MyAPI>('https://api.example.com', { transport })
 * ```
 */
export function createAuthTransport(options: AuthTransportOptions): AuthTransport {
  return new AuthTransport(options)
}
