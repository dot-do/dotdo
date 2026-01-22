/**
 * MCP Server Metadata Handler
 *
 * Implements the MCP Server Metadata endpoint for Model Context Protocol OAuth 2.1.
 * Returns server metadata at /.well-known/mcp-server-metadata
 *
 * @module @dotdo/oauth/mcp/server-metadata
 */

import type { Context } from 'hono'

/**
 * MCP Server Metadata as defined by the MCP specification.
 */
export interface MCPServerMetadata {
  /** The resource server URL */
  resource_server: string
  /** The authorization endpoint URL */
  authorization_endpoint: string
  /** The token endpoint URL */
  token_endpoint: string
  /** Optional registration endpoint URL */
  registration_endpoint?: string
  /** Optional revocation endpoint URL */
  revocation_endpoint?: string
  /** Optional introspection endpoint URL */
  introspection_endpoint?: string
  /** Optional resource indicator for RFC 8707 */
  resource_indicator?: string
  /** Supported OAuth scopes */
  scopes_supported?: string[]
  /** MCP protocol version */
  mcp_version?: string
}

/**
 * Options for creating an MCP server metadata handler.
 */
export interface MCPServerMetadataOptions {
  /** The resource server URL */
  resourceServer: string
  /** The authorization endpoint URL */
  authorizationEndpoint: string
  /** The token endpoint URL */
  tokenEndpoint: string
  /** Optional registration endpoint URL */
  registrationEndpoint?: string
  /** Optional revocation endpoint URL */
  revocationEndpoint?: string
  /** Optional introspection endpoint URL */
  introspectionEndpoint?: string
  /** Optional resource indicator for RFC 8707 */
  resourceIndicator?: string
  /** Supported OAuth scopes */
  scopesSupported?: string[]
  /** MCP protocol version */
  mcpVersion?: string
  /** Enable CORS headers for cross-origin access */
  enableCors?: boolean
}

/**
 * Creates a handler for the MCP Server Metadata endpoint.
 *
 * @param options - Configuration options for the metadata endpoint
 * @returns A Hono handler function
 *
 * @example
 * ```typescript
 * const handler = createMCPServerMetadataHandler({
 *   resourceServer: 'https://apis.do',
 *   authorizationEndpoint: 'https://oauth.do/authorize',
 *   tokenEndpoint: 'https://oauth.do/token',
 * })
 *
 * app.get('/.well-known/mcp-server-metadata', handler)
 * ```
 */
export function createMCPServerMetadataHandler(options: MCPServerMetadataOptions) {
  return (c: Context) => {
    const metadata: MCPServerMetadata = {
      resource_server: options.resourceServer,
      authorization_endpoint: options.authorizationEndpoint,
      token_endpoint: options.tokenEndpoint,
    }

    // Add optional fields if provided
    if (options.registrationEndpoint) {
      metadata.registration_endpoint = options.registrationEndpoint
    }
    if (options.revocationEndpoint) {
      metadata.revocation_endpoint = options.revocationEndpoint
    }
    if (options.introspectionEndpoint) {
      metadata.introspection_endpoint = options.introspectionEndpoint
    }
    if (options.resourceIndicator) {
      metadata.resource_indicator = options.resourceIndicator
    }
    if (options.scopesSupported) {
      metadata.scopes_supported = options.scopesSupported
    }
    if (options.mcpVersion) {
      metadata.mcp_version = options.mcpVersion
    }

    // Set CORS headers if enabled
    if (options.enableCors) {
      c.header('Access-Control-Allow-Origin', '*')
      c.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }

    return c.json(metadata)
  }
}
