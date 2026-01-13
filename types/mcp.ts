/**
 * Consolidated MCP (Model Context Protocol) Types
 *
 * Single source of truth for MCP types used across:
 * - objects/transport/mcp-server.ts (DO MCP integration)
 * - api/routes/mcp.ts (HTTP Streamable transport)
 * - api/generators/mcp-tools.ts (Tool generation)
 * - cli/mcp-stdio.ts (stdio transport)
 * - types/introspect.ts (Schema introspection)
 *
 * @see https://modelcontextprotocol.io/docs
 * @see https://www.jsonrpc.org/specification
 */

// ============================================================================
// JSON SCHEMA TYPES
// ============================================================================

/**
 * JSON Schema type definition for tool input schemas
 */
export interface JsonSchema {
  $schema?: string
  type: string
  properties?: Record<string, JsonSchema | JsonSchemaProperty>
  required?: string[]
  items?: JsonSchema
  description?: string
  [key: string]: unknown
}

/**
 * JSON Schema property definition
 */
export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: unknown[]
  default?: unknown
  [key: string]: unknown
}

// ============================================================================
// MCP TOOL TYPES
// ============================================================================

/**
 * MCP Tool definition as returned by tools/list
 *
 * This is the canonical type for MCP tools across the codebase.
 * Different components may use subset interfaces for their specific needs.
 */
export interface McpTool {
  /** Unique name identifying the tool (e.g., 'search', 'create_thing') */
  name: string
  /** Human-readable description of what the tool does */
  description: string
  /** JSON Schema for the tool's input parameters */
  inputSchema: McpToolInputSchema | Record<string, unknown>
}

/**
 * Structured input schema for MCP tools
 */
export interface McpToolInputSchema {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

/**
 * MCP Tool with handler (for tool registration)
 */
export interface McpToolWithHandler extends McpTool {
  /** Async function that implements the tool's functionality */
  handler: McpToolHandler
}

/**
 * Handler function type for MCP tools
 */
export type McpToolHandler = (params: Record<string, unknown>) => Promise<McpToolResult>

/**
 * Tool call request (from client to server)
 */
export interface McpToolCall {
  /** Tool name to invoke */
  name: string
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>
}

/**
 * Result of invoking an MCP tool
 */
export interface McpToolResult {
  /** Array of content blocks in the result */
  content: McpContent[]
  /** If true, the result represents an error condition */
  isError?: boolean
}

/**
 * Content block in a tool result
 */
export interface McpContent {
  /** Content type */
  type: 'text' | 'image' | 'resource'
  /** Text content (for type: 'text') */
  text?: string
  /** Base64-encoded data (for type: 'image') */
  data?: string
  /** MIME type for binary content */
  mimeType?: string
  /** Resource URI (for type: 'resource') */
  uri?: string
}

// ============================================================================
// MCP RESOURCE TYPES
// ============================================================================

/**
 * MCP Resource definition (as returned by resources/list)
 */
export interface McpResource {
  /** Resource URI (unique identifier) */
  uri: string
  /** Human-readable name */
  name: string
  /** Optional description */
  description?: string
  /** MIME type of the resource content */
  mimeType?: string
}

/**
 * MCP Resource content (as returned by resources/read)
 */
export interface McpResourceContent {
  /** Resource URI */
  uri: string
  /** MIME type */
  mimeType?: string
  /** Text content (for text resources) */
  text?: string
  /** Base64 blob (for binary resources) */
  blob?: string
}

// ============================================================================
// MCP PROMPT TYPES
// ============================================================================

/**
 * MCP Prompt argument definition
 */
export interface McpPromptArgument {
  /** Argument name */
  name: string
  /** Human-readable description */
  description?: string
  /** Whether the argument is required */
  required?: boolean
}

/**
 * MCP Prompt definition (as returned by prompts/list)
 */
export interface McpPromptInfo {
  /** Unique prompt name */
  name: string
  /** Human-readable description */
  description?: string
  /** Prompt arguments */
  arguments?: McpPromptArgument[]
}

// ============================================================================
// MCP SESSION TYPES
// ============================================================================

/**
 * MCP Session state (for HTTP Streamable transport)
 */
export interface McpSession {
  /** Unique session identifier */
  id: string
  /** Session creation time */
  createdAt: Date
  /** Last access time */
  lastAccessedAt: Date
  /** Last activity time */
  lastActivity?: Date
  /** Client information */
  clientInfo?: McpClientInfo
  /** Protocol version */
  protocolVersion?: string
  /** Session capabilities */
  capabilities?: Record<string, unknown>
  /** Registered tools for this session */
  tools?: Map<string, McpTool>
  /** Available resources for this session */
  resources?: Map<string, McpResource>
  /** Active subscriptions */
  subscriptions?: string[]
}

/**
 * MCP Client information (from initialize request)
 */
export interface McpClientInfo {
  /** Client name */
  name: string
  /** Client version */
  version: string
}

// ============================================================================
// MCP CONFIGURATION TYPES
// ============================================================================

/**
 * Tool configuration in $mcp.tools (for DO classes)
 */
export interface McpToolConfig {
  /** Tool description */
  description: string
  /** Input schema with property definitions */
  inputSchema: Record<string, JsonSchemaProperty>
  /** Required parameter names */
  required?: string[]
}

/**
 * Static $mcp configuration on DO classes
 */
export interface McpConfig {
  /** Tool configurations by name */
  tools?: Record<string, McpToolConfig>
  /** Resource names to expose */
  resources?: string[]
}

// ============================================================================
// JSON-RPC 2.0 TYPES
// ============================================================================

/**
 * JSON-RPC 2.0 base message
 */
export interface JsonRpcMessage {
  /** JSON-RPC version (always '2.0') */
  jsonrpc: '2.0'
  /** Request/response ID */
  id?: string | number | null
  /** Method name (for requests/notifications) */
  method?: string
  /** Parameters (for requests/notifications) */
  params?: Record<string, unknown>
  /** Result (for responses) */
  result?: unknown
  /** Error (for error responses) */
  error?: JsonRpcError
}

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  /** Request ID (required for requests, omit for notifications) */
  id?: string | number
  /** Method name */
  method: string
  /** Method parameters (MCP requires object, not array) */
  params?: Record<string, unknown>
}

/**
 * JSON-RPC 2.0 Response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  /** Request ID (null for notifications/errors without ID) */
  id: string | number | null
  /** Result (present on success) */
  result?: unknown
  /** Error (present on failure) */
  error?: JsonRpcError
}

/**
 * JSON-RPC 2.0 Notification (request without ID)
 */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  /** Method name */
  method: string
  /** Method parameters */
  params?: Record<string, unknown>
}

/**
 * JSON-RPC 2.0 Error object
 */
export interface JsonRpcError {
  /** Error code */
  code: number
  /** Error message */
  message: string
  /** Additional error data */
  data?: unknown
}

/**
 * Standard JSON-RPC error codes
 */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

export type JsonRpcErrorCode = (typeof JSON_RPC_ERRORS)[keyof typeof JSON_RPC_ERRORS]

// ============================================================================
// MCP SERVER/TRANSPORT TYPES
// ============================================================================

/**
 * MCP Server capabilities
 */
export interface McpServerCapabilities {
  /** Tools capability */
  tools?: { listChanged?: boolean }
  /** Resources capability */
  resources?: { subscribe?: boolean; listChanged?: boolean }
  /** Prompts capability */
  prompts?: { listChanged?: boolean }
  /** Logging capability */
  logging?: Record<string, unknown>
}

/**
 * MCP Server info
 */
export interface McpServerInfo {
  /** Server name */
  name: string
  /** Server version */
  version: string
}

/**
 * MCP Protocol constants
 */
export const MCP_PROTOCOL = {
  VERSION: '2024-11-05',
  LATEST_VERSION: '2024-11-05',
} as const

// ============================================================================
// MCP HANDLER OPTIONS
// ============================================================================

/**
 * Options for MCP request handlers
 */
export interface McpHandlerOptions {
  /** Request object */
  request: Request
  /** Durable Object instance */
  instance?: unknown
  /** Session ID */
  sessionId?: string
}

// ============================================================================
// CONVERSION HELPERS
// ============================================================================

/**
 * Convert a tool configuration to MCP tool format
 */
export function toolConfigToMcpTool(name: string, config: McpToolConfig): McpTool {
  const properties: Record<string, JsonSchemaProperty> = {}

  for (const [propName, propConfig] of Object.entries(config.inputSchema)) {
    properties[propName] = {
      type: propConfig.type,
      ...(propConfig.description && { description: propConfig.description }),
    }
  }

  return {
    name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties,
      required: config.required,
    },
  }
}

/**
 * Create a JSON-RPC error response
 */
export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  }
}

/**
 * Create a JSON-RPC success response
 */
export function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

/**
 * Create text content for tool result
 */
export function textContent(text: string): McpContent {
  return { type: 'text', text }
}

/**
 * Create a successful tool result
 */
export function toolResult(content: McpContent[]): McpToolResult {
  return { content }
}

/**
 * Create an error tool result
 */
export function toolError(message: string): McpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

// ============================================================================
// TYPE ALIASES FOR BACKWARD COMPATIBILITY
// ============================================================================

/**
 * @deprecated Use McpTool instead
 */
export type MCPTool = McpTool

/**
 * @deprecated Use McpToolResult instead
 */
export type MCPToolResult = McpToolResult

/**
 * @deprecated Use McpToolHandler instead
 */
export type MCPToolHandler = McpToolHandler

/**
 * @deprecated Use McpToolConfig instead
 */
export type ToolConfig = McpToolConfig

/**
 * Alias for introspection compatibility
 */
export type MCPToolSchema = McpTool

// ============================================================================
// GRAPH INTEGRATION TYPES
// ============================================================================

/**
 * Tool parameter definition stored in graph.
 */
export interface ToolParameter {
  name: string
  type: string
  description?: string
  required?: boolean
  schema?: Record<string, unknown>
}

/**
 * Tool definition stored as a Thing in the graph.
 * This is the structure stored in GraphThing.data.
 *
 * Index signature allows safe assignment from Record<string, unknown>
 * in type guards while maintaining type safety for known fields.
 */
export interface ToolThingData {
  id: string
  description: string
  parameters: ToolParameter[]
  handler?: string
  /** Index signature for compatibility with Record<string, unknown> */
  [key: string]: unknown
}

/**
 * Query options for filtering tools from graph.
 */
export interface ToolQuery {
  /** Filter by tool ID prefix */
  idPrefix?: string
  /** Filter by specific tool IDs */
  ids?: string[]
}

// ============================================================================
// CONVERSION HELPERS - Graph Integration
// ============================================================================

/**
 * Convert a Tool Thing from the graph to MCP tool format.
 *
 * @param toolThing - The GraphThing representing a Tool
 * @returns MCP tool definition
 *
 * @example
 * ```typescript
 * const mcpTool = toolThingToMcp({
 *   id: 'search',
 *   data: {
 *     id: 'search',
 *     description: 'Search items',
 *     parameters: [{ name: 'query', type: 'string', required: true }]
 *   }
 * })
 * ```
 */
export function toolThingToMcp(toolThing: {
  id: string
  data: Record<string, unknown> | null
}): McpTool {
  const data = toolThing.data as unknown as ToolThingData | null

  if (!data) {
    return {
      name: toolThing.id,
      description: 'Tool (no description)',
      inputSchema: { type: 'object', properties: {} },
    }
  }

  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []

  for (const param of data.parameters || []) {
    properties[param.name] = {
      type: param.type,
      ...(param.description && { description: param.description }),
    }

    if (param.required) {
      required.push(param.name)
    }
  }

  return {
    name: data.id,
    description: data.description,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 && { required }),
    },
  }
}

/**
 * Convert an MCP tool back to ToolThing data format.
 *
 * Useful for storing MCP tools in the graph.
 *
 * @param mcpTool - The MCP tool definition
 * @returns Partial ToolThingData suitable for graph storage
 *
 * @example
 * ```typescript
 * const thingData = mcpToToolThing({
 *   name: 'search',
 *   description: 'Search items',
 *   inputSchema: {
 *     type: 'object',
 *     properties: { query: { type: 'string' } },
 *     required: ['query']
 *   }
 * })
 * ```
 */
export function mcpToToolThing(mcpTool: McpTool): ToolThingData {
  const inputSchema = mcpTool.inputSchema as McpToolInputSchema | undefined
  const properties = inputSchema?.properties || {}
  const requiredSet = new Set(inputSchema?.required || [])

  const parameters: ToolParameter[] = Object.entries(properties).map(
    ([name, prop]) => ({
      name,
      type: prop.type,
      ...(prop.description && { description: prop.description }),
      required: requiredSet.has(name),
    })
  )

  return {
    id: mcpTool.name,
    description: mcpTool.description,
    parameters,
  }
}

// ============================================================================
// CONVERSION HELPERS - Agent SDK Integration
// ============================================================================

/**
 * Agent SDK ToolDefinition interface (subset for conversion)
 * Full interface is in agents/types.ts
 */
export interface AgentToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema | { type: string; properties?: Record<string, unknown> }
}

/**
 * Convert an agent ToolDefinition to MCP tool format.
 *
 * This bridges the agents/ module with MCP, allowing agent tools
 * to be exposed via MCP transport.
 *
 * @param toolDef - The agent ToolDefinition
 * @returns MCP tool definition
 *
 * @example
 * ```typescript
 * const mcpTool = toolDefinitionToMcp({
 *   name: 'search',
 *   description: 'Search items',
 *   inputSchema: z.object({ query: z.string() })
 * })
 * ```
 */
export function toolDefinitionToMcp(toolDef: AgentToolDefinition): McpTool {
  // Handle Zod schemas - check for _def property (Zod internal)
  const inputSchema = toolDef.inputSchema as Record<string, unknown>
  let mcpInputSchema: McpTool['inputSchema']

  if ('_def' in inputSchema) {
    // Zod schema - extract JSON schema representation
    // Note: Full Zod-to-JSON-Schema conversion would require zod-to-json-schema
    // For now, we create a basic object schema
    mcpInputSchema = {
      type: 'object',
      properties: {},
    }
  } else if ('type' in inputSchema && inputSchema.type === 'object') {
    // Already a JSON schema
    mcpInputSchema = inputSchema as McpTool['inputSchema']
  } else {
    // Unknown format - wrap as object
    mcpInputSchema = {
      type: 'object',
      properties: {},
    }
  }

  return {
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: mcpInputSchema,
  }
}

/**
 * Convert an MCP tool to agent ToolDefinition format (partial).
 *
 * Returns a partial definition without the execute function,
 * which must be provided separately.
 *
 * @param mcpTool - The MCP tool definition
 * @returns Partial agent ToolDefinition
 */
export function mcpToToolDefinition(mcpTool: McpTool): AgentToolDefinition {
  return {
    name: mcpTool.name,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema as JsonSchema,
  }
}
