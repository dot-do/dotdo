/**
 * OAuth Authorization Server Metadata Handler (RFC 8414)
 *
 * Implements the OAuth 2.0 Authorization Server Metadata endpoint.
 * Returns metadata at /.well-known/oauth-authorization-server
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 * @module @dotdo/oauth/mcp/auth-server-metadata
 */

import type { Context } from 'hono'

/**
 * OAuth Authorization Server Metadata as defined by RFC 8414.
 */
export interface AuthServerMetadata {
  /** The authorization server's issuer identifier */
  issuer: string
  /** URL of the authorization endpoint */
  authorization_endpoint: string
  /** URL of the token endpoint */
  token_endpoint: string
  /** URL of the JWKS endpoint */
  jwks_uri?: string
  /** URL of the dynamic client registration endpoint */
  registration_endpoint?: string
  /** Scopes supported by the authorization server */
  scopes_supported?: string[]
  /** Response types supported */
  response_types_supported: string[]
  /** Grant types supported */
  grant_types_supported: string[]
  /** Token endpoint authentication methods supported */
  token_endpoint_auth_methods_supported: string[]
  /** PKCE code challenge methods supported */
  code_challenge_methods_supported: string[]
  /** URL of the revocation endpoint */
  revocation_endpoint?: string
  /** URL of the introspection endpoint */
  introspection_endpoint?: string
  /** URL to human-readable documentation */
  service_documentation?: string
  /** Locales supported for the UI */
  ui_locales_supported?: string[]
}

/**
 * Options for creating an OAuth Authorization Server Metadata handler.
 */
export interface AuthServerMetadataOptions {
  /** The authorization server's issuer identifier */
  issuer: string
  /** URL of the authorization endpoint */
  authorizationEndpoint: string
  /** URL of the token endpoint */
  tokenEndpoint: string
  /** Scopes supported by the authorization server */
  scopesSupported: string[]
  /** URL of the JWKS endpoint */
  jwksUri?: string
  /** URL of the dynamic client registration endpoint */
  registrationEndpoint?: string
  /** URL of the revocation endpoint */
  revocationEndpoint?: string
  /** URL of the introspection endpoint */
  introspectionEndpoint?: string
  /** URL to human-readable documentation */
  serviceDocumentation?: string
  /** Locales supported for the UI */
  uiLocalesSupported?: string[]
  /** Additional response types supported (default: ['code']) */
  responseTypesSupported?: string[]
  /** Additional grant types supported (default: ['authorization_code', 'refresh_token']) */
  grantTypesSupported?: string[]
  /** Token endpoint auth methods (default: ['none', 'client_secret_basic', 'client_secret_post']) */
  tokenEndpointAuthMethodsSupported?: string[]
  /** PKCE methods supported (default: ['S256']) */
  codeChallengeMethodsSupported?: string[]
}

/**
 * Creates a handler for the OAuth Authorization Server Metadata endpoint (RFC 8414).
 *
 * @param options - Configuration options for the metadata endpoint
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createAuthServerMetadataHandler({
 *   issuer: 'https://oauth.do',
 *   authorizationEndpoint: 'https://oauth.do/authorize',
 *   tokenEndpoint: 'https://oauth.do/token',
 *   scopesSupported: ['read', 'write', 'admin'],
 * })
 *
 * app.get('/.well-known/oauth-authorization-server', handler)
 * ```
 */
export function createAuthServerMetadataHandler(options: AuthServerMetadataOptions) {
  return (c: Context) => {
    const metadata: AuthServerMetadata = {
      issuer: options.issuer,
      authorization_endpoint: options.authorizationEndpoint,
      token_endpoint: options.tokenEndpoint,
      scopes_supported: options.scopesSupported,
      // OAuth 2.1 defaults
      response_types_supported: options.responseTypesSupported ?? ['code'],
      grant_types_supported: options.grantTypesSupported ?? ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: options.tokenEndpointAuthMethodsSupported ?? [
        'none',
        'client_secret_basic',
        'client_secret_post',
      ],
      // OAuth 2.1 requires PKCE with S256
      code_challenge_methods_supported: options.codeChallengeMethodsSupported ?? ['S256'],
    }

    // Add optional fields if provided
    if (options.jwksUri) {
      metadata.jwks_uri = options.jwksUri
    }
    if (options.registrationEndpoint) {
      metadata.registration_endpoint = options.registrationEndpoint
    }
    if (options.revocationEndpoint) {
      metadata.revocation_endpoint = options.revocationEndpoint
    }
    if (options.introspectionEndpoint) {
      metadata.introspection_endpoint = options.introspectionEndpoint
    }
    if (options.serviceDocumentation) {
      metadata.service_documentation = options.serviceDocumentation
    }
    if (options.uiLocalesSupported) {
      metadata.ui_locales_supported = options.uiLocalesSupported
    }

    return c.json(metadata)
  }
}
