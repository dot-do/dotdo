/**
 * MCP Types
 *
 * Core type definitions for MCP (Model Context Protocol) server infrastructure.
 * Based on the official MCP specification and Cloudflare's agents framework.
 */

import type { DurableObjectState, DurableObjectNamespace, KVNamespace, Ai, RateLimit } from '@cloudflare/workers-types'

// ============================================================================
// Environment Types
// ============================================================================

/**
 * MCP Environment bindings required for the MCP server
 */
export interface McpEnv {
  /** MCP Durable Object namespace */
  MCP: DurableObjectNamespace
  /** OAuth session storage */
  OAUTH_KV: KVNamespace
  /** Cloudflare AI binding for tool execution */
  AI: Ai
  /** Cloudflare Rate Limiting binding (optional - falls back to in-memory) */
  RATE_LIMITER?: RateLimit
  /** WorkOS API key for AuthKit */
  WORKOS_API_KEY: string
  /** WorkOS Client ID */
  WORKOS_CLIENT_ID: string
  /** OAuth redirect URI */
  OAUTH_REDIRECT_URI: string
  /** JWT signing secret */
  JWT_SECRET: string
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * JWT payload structure for authenticated users
 */
export interface JwtPayload {
  /** Subject (user ID) */
  sub: string
  /** Issued at timestamp */
  iat: number
  /** Expiration timestamp */
  exp: number
  /** User email */
  email?: string
  /** Organization ID */
  org_id?: string
  /** User permissions */
  permissions: string[]
}

/**
 * Session data stored in KV
 */
export interface Session {
  /** Session ID */
  id: string
  /** User ID */
  userId: string
  /** Access token */
  accessToken: string
  /** Refresh token (if available) */
  refreshToken?: string
  /** User email */
  email?: string
  /** Organization ID */
  orgId?: string
  /** Permissions granted to this session */
  permissions: string[]
  /** Session creation timestamp */
  createdAt: number
  /** Session expiration timestamp */
  expiresAt: number
}

/**
 * OAuth state stored during authorization flow
 */
export interface OAuthState {
  /** State parameter for CSRF protection */
  state: string
  /** Code verifier for PKCE */
  codeVerifier: string
  /** Original redirect URI */
  redirectUri: string
  /** Timestamp when state was created */
  createdAt: number
}

/**
 * WorkOS user profile from AuthKit
 */
export interface WorkOSUser {
  /** User ID */
  id: string
  /** User email */
  email: string
  /** First name */
  firstName?: string
  /** Last name */
  lastName?: string
  /** Profile picture URL */
  profilePictureUrl?: string
  /** Organization memberships */
  organizationMemberships?: Array<{
    id: string
    organizationId: string
    role: {
      slug: string
    }
  }>
}

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface McpTool {
  /** Tool name (unique identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** JSON Schema for input parameters */
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
  /** Required permissions to use this tool */
  requiredPermissions?: string[]
}

/**
 * MCP Resource definition
 */
export interface McpResource {
  /** Resource URI */
  uri: string
  /** Human-readable name */
  name: string
  /** Description */
  description?: string
  /** MIME type */
  mimeType?: string
}

/**
 * MCP Prompt definition
 */
export interface McpPrompt {
  /** Prompt name */
  name: string
  /** Description */
  description?: string
  /** Arguments the prompt accepts */
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

/**
 * MCP Server capabilities
 */
export interface McpCapabilities {
  tools?: Record<string, McpTool>
  resources?: Record<string, McpResource>
  prompts?: Record<string, McpPrompt>
}

/**
 * MCP Server info
 */
export interface McpServerInfo {
  name: string
  version: string
}

/**
 * MCP Tool call request
 */
export interface McpToolCall {
  /** Tool name */
  name: string
  /** Tool arguments */
  arguments: Record<string, unknown>
}

/**
 * MCP Tool call result
 */
export interface McpToolResult {
  /** Content returned by the tool */
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
    resource?: McpResource
  }>
  /** Whether the tool call resulted in an error */
  isError?: boolean
}

// ============================================================================
// MCP Agent Props
// ============================================================================

/**
 * Props passed to MCP agent handlers
 */
export interface McpAgentProps {
  /** Authenticated user ID */
  userId: string
  /** User permissions */
  permissions: string[]
  /** Session ID */
  sessionId?: string
  /** Organization ID */
  orgId?: string
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Authenticated request context
 */
export interface AuthContext {
  /** Whether request is authenticated */
  authenticated: boolean
  /** User ID (if authenticated) */
  userId?: string
  /** User permissions */
  permissions: string[]
  /** Session data */
  session?: Session
  /** JWT payload */
  jwt?: JwtPayload
}

/**
 * MCP SSE message types
 */
export type McpSseMessage =
  | { type: 'initialize'; serverInfo: McpServerInfo; capabilities: McpCapabilities }
  | { type: 'tool_result'; id: string; result: McpToolResult }
  | { type: 'error'; id: string; error: string }
  | { type: 'ping' }

// ============================================================================
// Error Types
// ============================================================================

/**
 * MCP Error codes
 */
export enum McpErrorCode {
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  InvalidRequest = 'INVALID_REQUEST',
  ToolNotFound = 'TOOL_NOT_FOUND',
  ToolExecutionFailed = 'TOOL_EXECUTION_FAILED',
  InternalError = 'INTERNAL_ERROR',
}

/**
 * MCP Error response
 */
export interface McpError {
  code: McpErrorCode
  message: string
  details?: unknown
}

// ============================================================================
// Type Guards
// ============================================================================

export function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.sub === 'string' &&
    typeof obj.iat === 'number' &&
    typeof obj.exp === 'number' &&
    Array.isArray(obj.permissions)
  )
}

export function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    typeof obj.userId === 'string' &&
    typeof obj.accessToken === 'string' &&
    Array.isArray(obj.permissions) &&
    typeof obj.createdAt === 'number' &&
    typeof obj.expiresAt === 'number'
  )
}

export function isMcpToolCall(value: unknown): value is McpToolCall {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.name === 'string' &&
    typeof obj.arguments === 'object' &&
    obj.arguments !== null
  )
}
