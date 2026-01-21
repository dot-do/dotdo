/**
 * @dotdo/oauth MCP OAuth 2.1 Module
 *
 * Provides MCP (Model Context Protocol) OAuth 2.1 support including:
 * - MCP Server Metadata endpoint
 * - OAuth Authorization Server Metadata (RFC 8414)
 * - Protected Resource Metadata (RFC 9728)
 * - Resource Indicator support (RFC 8707)
 * - MCP-specific auth flow helpers
 *
 * @module @dotdo/oauth/mcp
 */

// MCP Server Metadata
export { createMCPServerMetadataHandler } from './server-metadata'
export type {
  MCPServerMetadata,
  MCPServerMetadataOptions,
} from './server-metadata'

// OAuth Authorization Server Metadata (RFC 8414)
export { createAuthServerMetadataHandler } from './auth-server-metadata'
export type {
  AuthServerMetadata,
  AuthServerMetadataOptions,
} from './auth-server-metadata'

// Protected Resource Metadata (RFC 9728)
export { createProtectedResourceMetadataHandler } from './resource-metadata'
export type {
  ProtectedResourceMetadata,
  ProtectedResourceMetadataOptions,
  BearerMethod,
} from './resource-metadata'

// MCP Auth Flow Helpers
export {
  createMCPAuthorizeHandler,
  createMCPCallbackHandler,
  createMCPTokenEndpoint,
  validateMCPScopes,
} from './mcp-flow'
export type {
  MCPOAuthProvider,
  MCPAuthorizeHandlerOptions,
  MCPCallbackHandlerOptions,
  MCPTokenEndpointOptions,
  MCPScopeValidationResult,
} from './mcp-flow'

// Sample metadata objects for testing type compatibility
// These are example metadata objects that can be used to verify types

/**
 * Sample MCP Server Metadata for type verification.
 * @internal
 */
export const SampleMCPServerMetadata = {
  resource_server: '',
  authorization_endpoint: '',
  token_endpoint: '',
} as const

/**
 * Sample Auth Server Metadata for type verification.
 * @internal
 */
export const SampleAuthServerMetadata = {
  issuer: '',
  authorization_endpoint: '',
  token_endpoint: '',
} as const

/**
 * Sample Protected Resource Metadata for type verification.
 * @internal
 */
export const SampleProtectedResourceMetadata = {
  resource: '',
  authorization_servers: [] as string[],
} as const
