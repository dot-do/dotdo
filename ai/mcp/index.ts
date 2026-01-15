/**
 * MCP (Model Context Protocol) Transport for AI Module
 *
 * Provides complete MCP support for the AI module:
 * - Client for connecting to MCP servers
 * - Server for exposing AI capabilities as MCP tools
 * - Tool registry and utilities
 * - Integration with AI template literals
 *
 * @example
 * ```typescript
 * import { createMcpClient, createMcpServer, createToolRegistry } from 'dotdo/ai/mcp'
 *
 * // Client usage - connect to an MCP server
 * const client = createMcpClient({
 *   clientInfo: { name: 'my-agent', version: '1.0.0' },
 *   transport: { type: 'http', url: 'https://mcp.example.com' },
 * })
 * await client.connect()
 * const tools = await client.listTools()
 * const result = await client.callTool('search', { query: 'hello' })
 *
 * // Server usage - expose tools
 * const server = createMcpServer({
 *   serverInfo: { name: 'my-server', version: '1.0.0' },
 *   tools: [
 *     {
 *       tool: { name: 'echo', description: 'Echo message', inputSchema: {...} },
 *       handler: async (params) => ({ content: [{ type: 'text', text: params.message }] }),
 *     },
 *   ],
 * })
 * const response = await server.handleRequest(request)
 *
 * // Tool registry
 * const registry = createToolRegistry()
 * registry.register(defineTool('add', 'Add numbers', {...}, handler))
 * ```
 *
 * @module ai/mcp
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Transport configuration
  McpTransportType,
  McpTransportConfig,
  HttpTransportConfig,
  WebSocketTransportConfig,
  StdioTransportConfig,
  WorkerTransportConfig,
  TransportConfig,

  // Client types
  McpClientState,
  McpClientEvents,
  McpClientOptions,
  ToolInvocationResult,

  // Server types
  ToolHandler,
  ToolContext,
  ToolRegistration,
  ResourceHandler,
  ResourceContext,
  ResourceRegistration,
  McpServerOptions,

  // AI integration
  AiFunctionToToolOptions,
  ToolUseModel,
  McpAgentConfig,

  // Message types
  TransportMessage,
  PendingRequest,

  // Re-exported from types/mcp
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
} from './types'

// ============================================================================
// Client Exports
// ============================================================================

export {
  McpClient,
  createMcpClient,
  createHttpClient,
  createWorkerClient,
} from './client'

// ============================================================================
// Server Exports
// ============================================================================

export {
  McpServer,
  createMcpServer,
  createToolServer,
  createMcpRequestHandler,
} from './server'

// ============================================================================
// Tool Registry Exports
// ============================================================================

export {
  ToolRegistry,
  createToolRegistry,
  defineTool,
  simpleTool,
  wrapFunction,
  aiToMcpTool,
  createAiTools,
  composeTool,
  chainTools,
  validateToolArgs,
  formatToolResult,
} from './tools'

// ============================================================================
// Re-export Utilities from types/mcp
// ============================================================================

export {
  // Protocol constants
  MCP_PROTOCOL,
  JSON_RPC_ERRORS,

  // JSON-RPC helpers
  jsonRpcError,
  jsonRpcSuccess,

  // Content helpers
  textContent,
  toolResult,
  toolError,

  // Type conversion
  toolConfigToMcpTool,
  toolDefinitionToMcp,
  mcpToToolDefinition,
  toolThingToMcp,
  mcpToToolThing,
} from '../../types/mcp'

// ============================================================================
// Convenience Functions
// ============================================================================

import { createHttpClient } from './client'
import { createToolServer } from './server'
import { createToolRegistry, defineTool } from './tools'
import type {
  McpClientOptions,
  McpServerOptions,
  ToolRegistration,
  McpServerInfo,
} from './types'

/**
 * Quick setup for a simple MCP client connecting to a URL
 */
export function connect(url: string, name = 'dotdo-client'): ReturnType<typeof createHttpClient> {
  return createHttpClient(url, { name, version: '1.0.0' })
}

/**
 * Quick setup for a simple MCP server with tools
 */
export function serve(
  name: string,
  tools: ToolRegistration[]
): ReturnType<typeof createToolServer> {
  return createToolServer({ name, version: '1.0.0' }, tools)
}

/**
 * Shorthand for defining a tool
 */
export const tool = defineTool

/**
 * Create a registry pre-populated with tools
 */
export function registry(...tools: ToolRegistration[]): ReturnType<typeof createToolRegistry> {
  const reg = createToolRegistry()
  for (const t of tools) {
    reg.register(t)
  }
  return reg
}
