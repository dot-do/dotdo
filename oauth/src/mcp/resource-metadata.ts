/**
 * Protected Resource Metadata Handler (RFC 9728)
 *
 * Implements the OAuth 2.0 Protected Resource Metadata endpoint.
 * Returns metadata at /.well-known/oauth-protected-resource
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 * @module @dotdo/oauth/mcp/resource-metadata
 */

import type { Context } from 'hono'

/**
 * Bearer token delivery methods supported per RFC 9728.
 */
export type BearerMethod = 'header' | 'body' | 'query'

/**
 * Protected Resource Metadata as defined by RFC 9728.
 */
export interface ProtectedResourceMetadata {
  /** The protected resource identifier (URI) */
  resource: string
  /** Array of authorization server issuer identifiers */
  authorization_servers: string[]
  /** Scopes supported by this protected resource */
  scopes_supported?: string[]
  /** Bearer token delivery methods supported */
  bearer_methods_supported?: BearerMethod[]
  /** URL to human-readable documentation */
  resource_documentation?: string
  /** Resource signing algorithm values supported */
  resource_signing_alg_values_supported?: string[]
  /** Resource encryption algorithm values supported */
  resource_encryption_alg_values_supported?: string[]
  /** Resource encryption encoding values supported */
  resource_encryption_enc_values_supported?: string[]
}

/**
 * Options for creating a Protected Resource Metadata handler.
 */
export interface ProtectedResourceMetadataOptions {
  /** The protected resource identifier (URI) */
  resource: string
  /** Array of authorization server issuer identifiers */
  authorizationServers: string[]
  /** Scopes supported by this protected resource */
  scopesSupported?: string[]
  /** Bearer token delivery methods supported */
  bearerMethodsSupported?: BearerMethod[]
  /** URL to human-readable documentation */
  resourceDocumentation?: string
  /** Resource signing algorithm values supported */
  resourceSigningAlgValuesSupported?: string[]
  /** Resource encryption algorithm values supported */
  resourceEncryptionAlgValuesSupported?: string[]
  /** Resource encryption encoding values supported */
  resourceEncryptionEncValuesSupported?: string[]
}

/**
 * Creates a handler for the Protected Resource Metadata endpoint (RFC 9728).
 *
 * @param options - Configuration options for the metadata endpoint
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createProtectedResourceMetadataHandler({
 *   resource: 'https://apis.do',
 *   authorizationServers: ['https://oauth.do'],
 *   scopesSupported: ['read', 'write'],
 * })
 *
 * app.get('/.well-known/oauth-protected-resource', handler)
 * ```
 */
export function createProtectedResourceMetadataHandler(options: ProtectedResourceMetadataOptions) {
  return (c: Context) => {
    const metadata: ProtectedResourceMetadata = {
      resource: options.resource,
      authorization_servers: options.authorizationServers,
    }

    // Add optional fields if provided
    if (options.scopesSupported) {
      metadata.scopes_supported = options.scopesSupported
    }
    if (options.bearerMethodsSupported) {
      metadata.bearer_methods_supported = options.bearerMethodsSupported
    }
    if (options.resourceDocumentation) {
      metadata.resource_documentation = options.resourceDocumentation
    }
    if (options.resourceSigningAlgValuesSupported) {
      metadata.resource_signing_alg_values_supported = options.resourceSigningAlgValuesSupported
    }
    if (options.resourceEncryptionAlgValuesSupported) {
      metadata.resource_encryption_alg_values_supported = options.resourceEncryptionAlgValuesSupported
    }
    if (options.resourceEncryptionEncValuesSupported) {
      metadata.resource_encryption_enc_values_supported = options.resourceEncryptionEncValuesSupported
    }

    return c.json(metadata)
  }
}
