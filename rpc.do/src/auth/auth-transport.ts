// Auth Transport - Transport wrapper that adds OAuth authentication headers
// Automatically handles token refresh on 401 responses

import type { RPCMessage, RPCResponse } from '../types'
import type { Transport, TransportState } from '../transport/types'
import { generateCorrelationId, CORRELATION_ID_HEADER } from '../transport/fetch'
import type { ITokenStore, StoredTokens } from './token-store'

/**
 * Token refresh function signature
 */
export type RefreshTokenFn = (refreshToken: string) => Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
}>

/**
 * Options for AuthTransport
 */
export interface AuthTransportOptions {
  /** Base URL of the RPC endpoint */
  url: string
  /** Token store for reading/writing tokens */
  tokenStore: ITokenStore
  /** Function to refresh expired tokens */
  onRefreshToken?: RefreshTokenFn
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
  /** Custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
}

/**
 * Auth Transport - adds OAuth authentication to RPC requests
 *
 * This transport wrapper:
 * 1. Attaches Authorization header when a valid token is available
 * 2. Proactively refreshes tokens that are about to expire
 * 3. Automatically retries requests on 401 with fresh tokens
 *
 * @example
 * ```typescript
 * const transport = new AuthTransport({
 *   url: 'https://api.example.com',
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
  private readonly url: string
  private readonly tokenStore: ITokenStore
  private readonly onRefreshToken?: RefreshTokenFn
  private readonly timeout: number
  private readonly baseCorrelationId?: string
  private readonly fetchImpl: typeof globalThis.fetch
  private isRefreshing: boolean = false

  constructor(options: AuthTransportOptions) {
    this.url = options.url
    this.tokenStore = options.tokenStore
    if (options.onRefreshToken !== undefined) {
      this.onRefreshToken = options.onRefreshToken
    }
    this.timeout = options.timeout ?? 30000
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  /**
   * Send an RPC message with authentication
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

    // Check for token expiry and refresh if needed (before the request)
    await this.ensureFreshToken()

    // Get current token
    const tokens = await this.tokenStore.getTokens()

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
    }

    if (tokens?.access_token) {
      headers['Authorization'] = `Bearer ${tokens.access_token}`
    }

    // Make the request
    let response: Response
    try {
      response = await this.fetchImpl(`${this.url}/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: message.method,
          args: message.args,
        }),
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      return {
        error: {
          type: 'TransportError',
          code: 'TRANSPORT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
        correlationId,
      }
    }

    // Handle 401 - try to refresh and retry
    if (response.status === 401 && tokens?.refresh_token && this.onRefreshToken) {
      const refreshed = await this.tryRefreshToken(tokens.refresh_token)
      if (refreshed) {
        // Retry with new token
        return this.retryWithFreshToken(message, correlationId)
      }
    }

    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) ?? correlationId

    if (!response.ok) {
      try {
        const errorBody = await response.json() as { type?: string; code?: string; message?: string }
        if (errorBody.code && errorBody.message) {
          return {
            error: {
              type: errorBody.type ?? 'RPCError',
              code: errorBody.code,
              message: errorBody.message,
              httpStatus: response.status,
            },
            correlationId: responseCorrelationId,
          }
        }
      } catch {
        // Failed to parse as JSON
      }

      return {
        error: {
          type: 'RPCError',
          code: 'INTERNAL_ERROR',
          message: `RPC error: ${response.status}`,
          httpStatus: response.status,
        },
        correlationId: responseCorrelationId,
      }
    }

    const result = await response.json() as T
    return {
      result,
      correlationId: responseCorrelationId,
    }
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [CORRELATION_ID_HEADER]: correlationId,
    }

    if (tokens?.access_token) {
      headers['Authorization'] = `Bearer ${tokens.access_token}`
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${this.url}/rpc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: message.method,
          args: message.args,
        }),
        signal: AbortSignal.timeout(this.timeout),
      })
    } catch (error) {
      return {
        error: {
          type: 'TransportError',
          code: 'TRANSPORT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
        correlationId,
      }
    }

    const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) ?? correlationId

    if (!response.ok) {
      return {
        error: {
          type: 'RPCError',
          code: 'INTERNAL_ERROR',
          message: `RPC error: ${response.status}`,
          httpStatus: response.status,
        },
        correlationId: responseCorrelationId,
      }
    }

    const result = await response.json() as T
    return {
      result,
      correlationId: responseCorrelationId,
    }
  }

  /**
   * Auth transport is stateless - no close needed
   */
  async close(): Promise<void> {
    // No-op
  }

  /**
   * Auth transport is always "connected"
   */
  getState(): TransportState {
    return 'CONNECTED' as TransportState
  }
}

/**
 * Create an auth transport (convenience function)
 */
export function createAuthTransport(options: AuthTransportOptions): AuthTransport {
  return new AuthTransport(options)
}
