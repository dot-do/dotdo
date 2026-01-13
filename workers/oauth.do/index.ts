/**
 * oauth.do - OAuth 2.0 Authorization Server for dotdo
 *
 * A complete OAuth 2.0/OIDC provider platform service that enables dotdo apps
 * to implement "Sign in with [YourApp]" functionality.
 *
 * Implements:
 * - RFC 6749 (OAuth 2.0)
 * - RFC 7636 (PKCE)
 * - RFC 7009 (Token Revocation)
 * - RFC 7662 (Token Introspection)
 * - RFC 7591 (Dynamic Client Registration)
 * - OpenID Connect Core 1.0
 *
 * @module workers/oauth.do
 *
 * @example
 * ```typescript
 * import { createOAuthServer } from 'dotdo/oauth'
 *
 * export default createOAuthServer({
 *   issuer: 'https://oauth.myapp.do',
 *   signingKey: env.OAUTH_SIGNING_KEY,
 * })
 * ```
 */

export type {
  OAuthServerConfig,
  OAuthClient,
  OAuthUser,
  OAuthDatabase,
  AuthorizationRequest,
  TokenRequest,
  TokenResponse,
  IntrospectionResponse,
  DiscoveryDocument,
  OAuthError,
  OAuthErrorCode,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from './types'

export {
  generateToken,
  generateAuthorizationCode,
  generateAccessToken,
  generateRefreshToken,
  generateClientId,
  generateClientSecret,
  generateIdToken,
  verifyCodeChallenge,
  signJWT,
  verifyJWT,
  getJWKS,
  hashSecret,
  verifySecret,
} from './crypto'

// Durable Objects
export { OAuthClientDO, OAuthTokenDO } from './objects'

import type {
  OAuthServerConfig,
  OAuthDatabase,
  StoredAuthRequest,
  OAuthClient,
  OAuthUser,
  AuthorizationCode,
  AccessToken,
  RefreshToken,
  UserConsent,
} from './types'
import {
  handleDiscovery,
  handleJWKS,
  handleAuthorization,
  handleAuthorizationCallback,
  handleToken,
  handleRevocation,
  handleIntrospection,
  handleUserInfo,
  handleClientRegistration,
} from './endpoints'

// ============================================================================
// OAuth Server Factory
// ============================================================================

/**
 * OAuth server instance with request handler
 */
export interface OAuthServer {
  /**
   * Handle an incoming request
   */
  fetch(request: Request): Promise<Response>

  /**
   * Store an authorization request (for testing/custom flows)
   */
  storeAuthRequest(id: string, request: Omit<StoredAuthRequest, 'id' | 'createdAt' | 'expiresAt'>): void

  /**
   * Get the configuration
   */
  config: OAuthServerConfig
}

/**
 * Create an OAuth 2.0 Authorization Server
 *
 * @param config - Server configuration
 * @param database - Optional database (uses in-memory mock if not provided)
 * @returns OAuth server instance
 *
 * @example
 * ```typescript
 * const server = createOAuthServer({
 *   issuer: 'https://oauth.myapp.do',
 *   signingKey: 'your-secret-key-at-least-32-chars',
 *   accessTokenTtl: 3600,
 *   refreshTokenTtl: 86400 * 30,
 * })
 *
 * export default {
 *   fetch: server.fetch
 * }
 * ```
 */
export function createOAuthServer(
  config: OAuthServerConfig,
  database?: Partial<OAuthDatabase>
): OAuthServer {
  // Apply defaults
  const fullConfig: OAuthServerConfig = {
    accessTokenTtl: 3600,
    refreshTokenTtl: 86400 * 30,
    authorizationCodeTtl: 600,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    enforceHttps: false,
    loginUrl: `${config.issuer}/login`,
    consentUrl: `${config.issuer}/consent`,
    ...config,
  }

  // Create or use provided database
  const db: OAuthDatabase = {
    clients: database?.clients || new Map<string, OAuthClient>(),
    authCodes: database?.authCodes || new Map<string, AuthorizationCode>(),
    tokens: database?.tokens || new Map<string, AccessToken>(),
    refreshTokens: database?.refreshTokens || new Map<string, RefreshToken>(),
    consents: database?.consents || new Map<string, UserConsent>(),
    users: database?.users || new Map<string, OAuthUser>(),
    seedClient(data: OAuthClient) {
      this.clients.set(data.clientId, data)
    },
    seedUser(data: OAuthUser) {
      this.users.set(data.id, data)
    },
  }

  // Store for authorization requests (in-flight auth flows)
  const authRequestStore = new Map<string, StoredAuthRequest>()

  return {
    config: fullConfig,

    storeAuthRequest(
      id: string,
      request: Omit<StoredAuthRequest, 'id' | 'createdAt' | 'expiresAt'>
    ) {
      const stored: StoredAuthRequest = {
        ...request,
        id,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 600000),
      }
      authRequestStore.set(id, stored)
    },

    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url)
      const path = url.pathname

      // CORS headers for browser clients
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
          },
        })
      }

      try {
        // Route to appropriate handler
        switch (path) {
          // OpenID Connect Discovery
          case '/.well-known/openid-configuration':
            return handleDiscovery(fullConfig)

          // JWKS
          case '/.well-known/jwks.json':
            return await handleJWKS(fullConfig)

          // Authorization Endpoint
          case '/authorize':
            return await handleAuthorization(request, fullConfig, db, authRequestStore)

          // Authorization Callback (after login/consent)
          case '/authorize/callback':
            return await handleAuthorizationCallback(request, fullConfig, db, authRequestStore)

          // Token Endpoint
          case '/token':
            if (request.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405 })
            }
            return await handleToken(request, fullConfig, db)

          // Token Revocation
          case '/revoke':
            if (request.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405 })
            }
            return await handleRevocation(request, fullConfig, db)

          // Token Introspection
          case '/introspect':
            if (request.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405 })
            }
            return await handleIntrospection(request, fullConfig, db)

          // UserInfo Endpoint
          case '/userinfo':
            if (request.method !== 'GET' && request.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405 })
            }
            return await handleUserInfo(request, fullConfig, db)

          // Client Registration
          case '/register':
            if (request.method !== 'POST') {
              return new Response('Method Not Allowed', { status: 405 })
            }
            return await handleClientRegistration(request, fullConfig, db)

          // Health check
          case '/health':
            return new Response(JSON.stringify({ status: 'ok' }), {
              headers: { 'Content-Type': 'application/json' },
            })

          default:
            return new Response('Not Found', { status: 404 })
        }
      } catch (error) {
        console.error('OAuth server error:', error)
        return new Response(
          JSON.stringify({
            error: 'server_error',
            error_description: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    },
  }
}

// ============================================================================
// Default Export - Worker Handler
// ============================================================================

/**
 * Environment bindings for oauth.do worker
 */
export interface OAuthEnv {
  /**
   * OAuth issuer URL
   */
  OAUTH_ISSUER: string

  /**
   * Signing key for JWTs
   */
  OAUTH_SIGNING_KEY: string

  /**
   * D1 database for OAuth storage
   */
  DB?: D1Database

  /**
   * Durable Object bindings
   */
  OAUTH_CLIENTS?: DurableObjectNamespace
  OAUTH_TOKENS?: DurableObjectNamespace
}

/**
 * Create a Worker-compatible OAuth server
 */
export function OAuthWorker(): ExportedHandler<OAuthEnv> {
  return {
    async fetch(request: Request, env: OAuthEnv): Promise<Response> {
      const server = createOAuthServer({
        issuer: env.OAUTH_ISSUER,
        signingKey: env.OAUTH_SIGNING_KEY,
      })
      return server.fetch(request)
    },
  }
}

export default OAuthWorker()
