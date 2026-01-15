/**
 * MCP Transport Types for AI Module
 *
 * Extends the base MCP types with AI-specific transport functionality
 * for connecting AI agents to MCP servers and exposing AI capabilities as MCP tools.
 *
 * @module ai/mcp/types
 */

import type {
  McpTool,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPromptInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpClientInfo,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonSchemaProperty,
} from '../../types/mcp'

// Re-export base types for convenience
export type {
  McpTool,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPromptInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpClientInfo,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonSchemaProperty,
}

// ============================================================================
// Transport Configuration Types
// ============================================================================

/**
 * MCP Transport type
 */
export type McpTransportType = 'http' | 'websocket' | 'stdio' | 'worker'

/**
 * Base transport configuration
 */
export interface McpTransportConfig {
  /** Transport type */
  type: McpTransportType
  /** Connection timeout in ms */
  timeout?: number
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean
  /** Max reconnection attempts */
  maxReconnectAttempts?: number
  /** Reconnection delay in ms */
  reconnectDelay?: number
}

/**
 * HTTP transport configuration
 */
export interface HttpTransportConfig extends McpTransportConfig {
  type: 'http'
  /** Target URL for the MCP server */
  url: string
  /** Optional headers to include in requests */
  headers?: Record<string, string>
  /** Custom fetch implementation */
  fetch?: typeof fetch
}

/**
 * WebSocket transport configuration
 */
export interface WebSocketTransportConfig extends McpTransportConfig {
  type: 'websocket'
  /** WebSocket URL */
  url: string
  /** Optional protocols */
  protocols?: string[]
}

/**
 * stdio transport configuration
 */
export interface StdioTransportConfig extends McpTransportConfig {
  type: 'stdio'
  /** stdin stream */
  stdin: NodeJS.ReadableStream
  /** stdout stream */
  stdout: NodeJS.WritableStream
  /** stderr stream (optional) */
  stderr?: NodeJS.WritableStream
  /** Message delimiter (default: '\n') */
  delimiter?: string
}

/**
 * Worker transport configuration (for Cloudflare Workers)
 */
export interface WorkerTransportConfig extends McpTransportConfig {
  type: 'worker'
  /** Durable Object stub or Worker binding */
  binding: unknown
  /** Namespace for multi-tenant scenarios */
  namespace?: string
}

/**
 * Union of all transport configurations
 */
export type TransportConfig =
  | HttpTransportConfig
  | WebSocketTransportConfig
  | StdioTransportConfig
  | WorkerTransportConfig

// ============================================================================
// Client Types
// ============================================================================

/**
 * MCP Client state
 */
export type McpClientState = 'disconnected' | 'connecting' | 'connected' | 'initialized' | 'error'

/**
 * MCP Client events
 */
export interface McpClientEvents {
  connect: () => void
  disconnect: () => void
  error: (error: Error) => void
  toolsChanged: (tools: McpTool[]) => void
  resourcesChanged: (resources: McpResource[]) => void
  notification: (method: string, params: Record<string, unknown>) => void
}

/**
 * MCP Client options
 */
export interface McpClientOptions {
  /** Client information for handshake */
  clientInfo: McpClientInfo
  /** Transport configuration */
  transport: TransportConfig
  /** Capabilities to request from server */
  requestedCapabilities?: Partial<McpServerCapabilities>
}

/**
 * Tool invocation result with metadata
 */
export interface ToolInvocationResult {
  /** Tool result */
  result: McpToolResult
  /** Invocation latency in ms */
  latencyMs: number
  /** Whether result was cached */
  cached?: boolean
  /** Tool that was invoked */
  tool: string
  /** Arguments used */
  arguments: Record<string, unknown>
}

// ============================================================================
// Server Types
// ============================================================================

/**
 * Tool handler function type
 */
export type ToolHandler<T = Record<string, unknown>> = (
  params: T,
  context: ToolContext
) => Promise<McpToolResult> | McpToolResult

/**
 * Context provided to tool handlers
 */
export interface ToolContext {
  /** Session ID */
  sessionId: string
  /** Request metadata */
  metadata?: Record<string, unknown>
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Tool registration with handler
 */
export interface ToolRegistration {
  /** Tool definition */
  tool: McpTool
  /** Tool handler */
  handler: ToolHandler
  /** Whether tool is enabled */
  enabled?: boolean
  /** Rate limit (calls per minute) */
  rateLimit?: number
}

/**
 * Resource handler function type
 */
export type ResourceHandler = (
  uri: string,
  context: ResourceContext
) => Promise<McpResourceContent> | McpResourceContent

/**
 * Context provided to resource handlers
 */
export interface ResourceContext {
  /** Session ID */
  sessionId: string
  /** Parsed URI components */
  uriComponents: {
    scheme: string
    host: string
    path: string
    query?: Record<string, string>
  }
}

/**
 * Resource registration
 */
export interface ResourceRegistration {
  /** Resource definition */
  resource: McpResource
  /** Resource handler */
  handler: ResourceHandler
  /** URI pattern for matching (supports wildcards) */
  pattern?: string
}

/**
 * MCP Server options
 */
export interface McpServerOptions {
  /** Server information */
  serverInfo: McpServerInfo
  /** Server capabilities */
  capabilities?: McpServerCapabilities
  /** Initial tools */
  tools?: ToolRegistration[]
  /** Initial resources */
  resources?: ResourceRegistration[]
  /** Initial prompts */
  prompts?: McpPromptInfo[]
  /** Session timeout in ms */
  sessionTimeout?: number
  /** Maximum concurrent sessions */
  maxSessions?: number
}

// ============================================================================
// AI Integration Types
// ============================================================================

/**
 * AI function to MCP tool conversion options
 */
export interface AiFunctionToToolOptions {
  /** Override tool name */
  name?: string
  /** Override description */
  description?: string
  /** Additional input schema properties */
  additionalProperties?: Record<string, JsonSchemaProperty>
  /** Mark specific parameters as required */
  required?: string[]
}

/**
 * LLM model that supports tool use
 */
export interface ToolUseModel {
  /** Model identifier */
  model: string
  /** Provider name */
  provider: string
  /** Whether model supports parallel tool calls */
  supportsParallelCalls?: boolean
  /** Maximum tools per request */
  maxTools?: number
}

/**
 * Configuration for AI agent using MCP tools
 */
export interface McpAgentConfig {
  /** MCP client options */
  client: McpClientOptions
  /** LLM model to use for reasoning */
  model: ToolUseModel
  /** System prompt for the agent */
  systemPrompt?: string
  /** Maximum tool calls per turn */
  maxToolCalls?: number
  /** Tool call timeout in ms */
  toolCallTimeout?: number
}

// ============================================================================
// Message Types (for internal transport)
// ============================================================================

/**
 * Transport message envelope
 */
export interface TransportMessage {
  /** Message ID */
  id: string
  /** Message type */
  type: 'request' | 'response' | 'notification'
  /** Message payload */
  payload: JsonRpcRequest | JsonRpcResponse
  /** Timestamp */
  timestamp: number
}

/**
 * Pending request tracker
 */
export interface PendingRequest {
  /** Request ID */
  id: string | number
  /** Request method */
  method: string
  /** Promise resolver */
  resolve: (response: JsonRpcResponse) => void
  /** Promise rejector */
  reject: (error: Error) => void
  /** Request timeout handle */
  timeoutHandle?: ReturnType<typeof setTimeout>
  /** Request timestamp */
  timestamp: number
}
