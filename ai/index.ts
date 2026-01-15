/**
 * AI Module
 *
 * Provides AI functionality for dotdo:
 * - Template literal API for convenient AI operations
 * - AI Gateway client for multiple providers
 * - Integration with Cloudflare Workers AI
 * - MCP (Model Context Protocol) transport for tool integration
 */

// Template literal functions
export {
  ai,
  write,
  summarize,
  list,
  extract,
  is,
  decide,
  // Human-in-loop functions
  ask,
  approve,
  review,
  // Configuration
  configure,
  getConfig,
  setHumanTaskExecutor,
  getHumanTaskExecutor,
  // Types
  type TemplateLiteralConfig,
  type TemplateLiteralOptions,
  type WriteResult,
  type ExtractResult,
  type PipelinePromise,
  type JSONSchema,
  type HumanOptions,
  type ReviewResult,
  type HumanTaskExecutor,
} from './template-literals'

// Re-export default as convenience object
export { default as templateLiterals } from './template-literals'

// AI Gateway (from lib)
export {
  AIGatewayClient,
  type AIGatewayEnv,
  type ChatMessage,
  type ChatResponse,
} from '../lib/ai/gateway'

// MCP (Model Context Protocol) Transport
export {
  // Client
  McpClient,
  createMcpClient,
  createHttpClient,
  createWorkerClient,

  // Server
  McpServer,
  createMcpServer,
  createToolServer,
  createMcpRequestHandler,

  // Tool Registry
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

  // Convenience functions
  connect,
  serve,
  tool,
  registry,

  // Re-exported from types/mcp
  MCP_PROTOCOL,
  JSON_RPC_ERRORS,
  jsonRpcError,
  jsonRpcSuccess,
  textContent,
  toolResult,
  toolError,
} from './mcp'

// MCP Types
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

  // MCP core types (re-exported)
  McpTool,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPromptInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpClientInfo,
} from './mcp'
