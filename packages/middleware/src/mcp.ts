/**
 * MCP (Model Context Protocol) Middleware for Hono
 *
 * Implements the MCP protocol for tool and resource handling.
 * Based on the MCP specification at https://modelcontextprotocol.io/
 *
 * @example
 * ```typescript
 * import { mcpMiddleware, createToolRegistry, createResourceRegistry } from '@dotdo/middleware'
 *
 * const tools = createToolRegistry()
 * tools.register({
 *   tool: {
 *     name: 'search',
 *     description: 'Search for items',
 *     inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
 *   },
 *   handler: async (params) => ({ content: [{ type: 'text', text: `Results for: ${params.query}` }] }),
 * })
 *
 * app.use('/mcp/*', mcpMiddleware({ tools }))
 * ```
 *
 * @module @dotdo/middleware/mcp
 */

import type { Context, MiddlewareHandler } from 'hono'

// ============================================================================
// MCP Type Definitions
// ============================================================================

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

/**
 * MCP Tool definition
 */
export interface McpTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, JsonSchemaProperty>
    required?: string[]
  }
}

/**
 * MCP Tool result content
 */
export interface McpContent {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  uri?: string
}

/**
 * MCP Tool result
 */
export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

/**
 * Tool handler function
 */
export type ToolHandler = (
  params: Record<string, unknown>
) => Promise<McpToolResult> | McpToolResult

/**
 * Tool registration
 */
export interface ToolRegistration {
  tool: McpTool
  handler: ToolHandler
  enabled?: boolean
}

/**
 * MCP Resource definition
 */
export interface McpResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

/**
 * MCP Resource content
 */
export interface McpResourceContent {
  uri: string
  text?: string
  blob?: string
  mimeType?: string
}

/**
 * Resource handler function
 */
export type ResourceHandler = (
  uri: string
) => Promise<McpResourceContent> | McpResourceContent

/**
 * Resource registration
 */
export interface ResourceRegistration {
  resource: McpResource
  handler: ResourceHandler
}

/**
 * MCP Server info
 */
export interface McpServerInfo {
  name: string
  version: string
}

/**
 * MCP Server capabilities
 */
export interface McpServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
}

/**
 * JSON-RPC request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

/**
 * JSON-RPC response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * MCP Session
 */
interface McpSession {
  id: string
  createdAt: Date
  lastAccessedAt: Date
  clientInfo?: { name: string; version: string }
  protocolVersion?: string
}

// ============================================================================
// JSON-RPC Constants
// ============================================================================

const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

const MCP_PROTOCOL_VERSION = '2024-11-05'

// ============================================================================
// JSON-RPC Helpers
// ============================================================================

function jsonRpcError(
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

function jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Registry for MCP tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map()

  /**
   * Register a tool with its handler
   */
  register(registration: ToolRegistration): void {
    this.tools.set(registration.tool.name, {
      ...registration,
      enabled: registration.enabled ?? true,
    })
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    const registration = this.tools.get(name)
    return registration !== undefined && registration.enabled !== false
  }

  /**
   * Get a tool registration
   */
  get(name: string): ToolRegistration | undefined {
    const registration = this.tools.get(name)
    if (registration && registration.enabled !== false) {
      return registration
    }
    return undefined
  }

  /**
   * Get all registered tools
   */
  getAll(): McpTool[] {
    return Array.from(this.tools.values())
      .filter((r) => r.enabled !== false)
      .map((r) => r.tool)
  }

  /**
   * Call a tool by name with params
   */
  async call(name: string, params: Record<string, unknown> = {}): Promise<McpToolResult> {
    const registration = this.get(name)
    if (!registration) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${name}` }],
        isError: true,
      }
    }

    try {
      return await registration.handler(params)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      }
    }
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear()
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size
  }
}

/**
 * Create a new tool registry
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
}

// ============================================================================
// Resource Registry
// ============================================================================

/**
 * Registry for MCP resources
 */
export class ResourceRegistry {
  private resources: Map<string, ResourceRegistration> = new Map()

  /**
   * Register a resource with its handler
   */
  register(registration: ResourceRegistration): void {
    this.resources.set(registration.resource.uri, registration)
  }

  /**
   * Unregister a resource
   */
  unregister(uri: string): boolean {
    return this.resources.delete(uri)
  }

  /**
   * Check if a resource exists
   */
  has(uri: string): boolean {
    return this.resources.has(uri)
  }

  /**
   * Get a resource registration
   */
  get(uri: string): ResourceRegistration | undefined {
    return this.resources.get(uri)
  }

  /**
   * Get all registered resources
   */
  getAll(): McpResource[] {
    return Array.from(this.resources.values()).map((r) => r.resource)
  }

  /**
   * Read resource content
   */
  async read(uri: string): Promise<McpResourceContent> {
    const registration = this.resources.get(uri)
    if (!registration) {
      throw new Error(`Resource not found: ${uri}`)
    }
    return registration.handler(uri)
  }

  /**
   * Clear all resources
   */
  clear(): void {
    this.resources.clear()
  }

  /**
   * Get resource count
   */
  get size(): number {
    return this.resources.size
  }
}

/**
 * Create a new resource registry
 */
export function createResourceRegistry(): ResourceRegistry {
  return new ResourceRegistry()
}

// ============================================================================
// MCP Middleware Configuration
// ============================================================================

/**
 * MCP middleware configuration
 */
export interface McpMiddlewareConfig {
  /** Tool registry */
  tools?: ToolRegistry
  /** Resource registry */
  resources?: ResourceRegistry
  /** Server info */
  serverInfo?: McpServerInfo
  /** Session timeout in ms (default: 5 minutes) */
  sessionTimeout?: number
  /** Maximum sessions (default: 100) */
  maxSessions?: number
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

/**
 * MCP Server that handles JSON-RPC requests
 */
class McpServer {
  private config: Required<McpMiddlewareConfig>
  private sessions: Map<string, McpSession> = new Map()

  constructor(config: McpMiddlewareConfig) {
    this.config = {
      tools: config.tools ?? createToolRegistry(),
      resources: config.resources ?? createResourceRegistry(),
      serverInfo: config.serverInfo ?? { name: 'dotdo-mcp', version: '1.0.0' },
      sessionTimeout: config.sessionTimeout ?? 300000,
      maxSessions: config.maxSessions ?? 100,
    }
  }

  /**
   * Get server capabilities
   */
  private getCapabilities(): McpServerCapabilities {
    const capabilities: McpServerCapabilities = {}

    if (this.config.tools.size > 0) {
      capabilities.tools = { listChanged: true }
    }

    if (this.config.resources.size > 0) {
      capabilities.resources = { subscribe: true, listChanged: true }
    }

    return capabilities
  }

  /**
   * Get or create a session
   */
  private getOrCreateSession(sessionId: string | null): McpSession {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!
      session.lastAccessedAt = new Date()
      return session
    }

    // Create new session
    const newSession: McpSession = {
      id: sessionId ?? crypto.randomUUID(),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    }

    // Evict oldest session if at capacity
    if (this.sessions.size >= this.config.maxSessions) {
      let oldestSession: McpSession | null = null
      for (const session of this.sessions.values()) {
        if (!oldestSession || session.lastAccessedAt < oldestSession.lastAccessedAt) {
          oldestSession = session
        }
      }
      if (oldestSession) {
        this.sessions.delete(oldestSession.id)
      }
    }

    this.sessions.set(newSession.id, newSession)
    return newSession
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId)
  }

  /**
   * Validate session exists
   */
  private validateSession(sessionId: string | null): McpSession | null {
    if (!sessionId) return null
    return this.sessions.get(sessionId) ?? null
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(
    request: JsonRpcRequest,
    sessionId: string | null
  ): Promise<{ response: JsonRpcResponse; session?: McpSession }> {
    // Handle methods that don't require session
    if (request.method === 'ping') {
      return { response: jsonRpcSuccess(request.id ?? null, {}) }
    }

    if (request.method === 'initialize') {
      const params = request.params as {
        protocolVersion?: string
        clientInfo?: { name: string; version: string }
      } | undefined

      const session = this.getOrCreateSession(sessionId)
      session.protocolVersion = params?.protocolVersion
      session.clientInfo = params?.clientInfo

      return {
        response: jsonRpcSuccess(request.id ?? null, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: this.getCapabilities(),
          serverInfo: this.config.serverInfo,
        }),
        session,
      }
    }

    // All other methods require a valid session
    const session = this.validateSession(sessionId)
    if (!session) {
      return {
        response: jsonRpcError(
          request.id ?? null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          sessionId ? 'Session not found' : 'Session not initialized'
        ),
      }
    }

    session.lastAccessedAt = new Date()

    switch (request.method) {
      case 'tools/list':
        return {
          response: jsonRpcSuccess(request.id ?? null, {
            tools: this.config.tools.getAll(),
          }),
          session,
        }

      case 'tools/call':
        return {
          response: await this.handleToolCall(request, session),
          session,
        }

      case 'resources/list':
        return {
          response: jsonRpcSuccess(request.id ?? null, {
            resources: this.config.resources.getAll(),
          }),
          session,
        }

      case 'resources/read':
        return {
          response: await this.handleResourceRead(request),
          session,
        }

      default:
        return {
          response: jsonRpcError(
            request.id ?? null,
            JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            `Method not found: ${request.method}`
          ),
          session,
        }
    }
  }

  /**
   * Handle tools/call method
   */
  private async handleToolCall(
    request: JsonRpcRequest,
    _session: McpSession
  ): Promise<JsonRpcResponse> {
    const params = request.params as {
      name?: string
      arguments?: Record<string, unknown>
    } | undefined

    if (!params?.name) {
      return jsonRpcError(request.id ?? null, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name')
    }

    const registration = this.config.tools.get(params.name)
    if (!registration) {
      return jsonRpcError(
        request.id ?? null,
        JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        `Tool not found: ${params.name}`
      )
    }

    // Validate required arguments
    const toolArgs = params.arguments ?? {}
    const requiredFields = registration.tool.inputSchema.required ?? []

    for (const field of requiredFields) {
      if (!(field in toolArgs)) {
        return jsonRpcError(
          request.id ?? null,
          JSON_RPC_ERRORS.INVALID_PARAMS,
          `Missing required argument: ${field}`
        )
      }
    }

    // Call the tool
    try {
      const result = await registration.handler(toolArgs)
      return jsonRpcSuccess(request.id ?? null, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return jsonRpcSuccess(request.id ?? null, {
        content: [{ type: 'text', text: message }],
        isError: true,
      })
    }
  }

  /**
   * Handle resources/read method
   */
  private async handleResourceRead(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = request.params as { uri?: string } | undefined

    if (!params?.uri) {
      return jsonRpcError(request.id ?? null, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing resource URI')
    }

    if (!this.config.resources.has(params.uri)) {
      return jsonRpcError(
        request.id ?? null,
        JSON_RPC_ERRORS.INVALID_PARAMS,
        `Resource not found: ${params.uri}`
      )
    }

    try {
      const content = await this.config.resources.read(params.uri)
      return jsonRpcSuccess(request.id ?? null, { contents: [content] })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return jsonRpcError(request.id ?? null, JSON_RPC_ERRORS.INTERNAL_ERROR, message)
    }
  }

  /**
   * Handle HTTP request
   */
  async handleHttpRequest(c: Context): Promise<Response> {
    const method = c.req.method

    // GET: SSE stream
    if (method === 'GET') {
      return this.handleSseRequest(c)
    }

    // DELETE: Terminate session
    if (method === 'DELETE') {
      return this.handleDeleteSession(c)
    }

    // Only POST for JSON-RPC
    if (method !== 'POST') {
      return c.json(
        jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Method not allowed'),
        405,
        { Allow: 'GET, POST, DELETE' }
      )
    }

    // Parse request body
    let body: JsonRpcRequest | JsonRpcRequest[]
    try {
      body = await c.req.json()
    } catch {
      return c.json(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error'))
    }

    const sessionId =
      c.req.header('mcp-session-id') || c.req.header('Mcp-Session-Id') || null

    // Handle batch requests
    const requests = Array.isArray(body) ? body : [body]
    const responses: JsonRpcResponse[] = []
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    let session: McpSession | undefined
    let allNotifications = true

    for (const req of requests) {
      // Validate JSON-RPC format
      if (req.jsonrpc !== '2.0') {
        responses.push(
          jsonRpcError(req.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC version')
        )
        if (req.id !== undefined) allNotifications = false
        continue
      }

      // Notifications have no id
      if (req.id === undefined) {
        continue
      }

      allNotifications = false

      // Handle method
      const result = await this.handleRequest(req, sessionId)
      responses.push(result.response)

      if (result.session) {
        session = result.session
      }
    }

    // Return 204 for all notifications
    if (allNotifications && responses.length === 0) {
      return new Response(null, { status: 204 })
    }

    // Add session ID to response
    if (session) {
      responseHeaders['Mcp-Session-Id'] = session.id
    }

    // Return response(s)
    const responseBody = Array.isArray(body) ? responses : responses[0]
    return c.json(responseBody, 200, responseHeaders)
  }

  /**
   * Handle SSE stream request
   */
  private handleSseRequest(c: Context): Response {
    const sessionId =
      c.req.header('mcp-session-id') || c.req.header('Mcp-Session-Id') || null

    if (!sessionId) {
      return c.json(
        jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing Mcp-Session-Id header'),
        400
      )
    }

    if (!this.sessions.has(sessionId)) {
      return c.json(
        jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found'),
        404
      )
    }

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'))
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Mcp-Session-Id': sessionId,
      },
    })
  }

  /**
   * Handle DELETE session request
   */
  private handleDeleteSession(c: Context): Response {
    const sessionId =
      c.req.header('mcp-session-id') || c.req.header('Mcp-Session-Id') || null

    if (!sessionId) {
      return c.json(
        jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing Mcp-Session-Id header'),
        400
      )
    }

    if (!this.deleteSession(sessionId)) {
      return c.json(
        jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found'),
        404
      )
    }

    return new Response(null, { status: 204 })
  }
}

// ============================================================================
// MCP Middleware Factory
// ============================================================================

/**
 * Create MCP middleware for Hono
 *
 * @example
 * ```typescript
 * import { mcpMiddleware, createToolRegistry } from '@dotdo/middleware'
 *
 * const tools = createToolRegistry()
 * tools.register({
 *   tool: {
 *     name: 'hello',
 *     description: 'Say hello',
 *     inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
 *   },
 *   handler: async (params) => ({
 *     content: [{ type: 'text', text: `Hello, ${params.name || 'World'}!` }],
 *   }),
 * })
 *
 * app.use('/mcp/*', mcpMiddleware({ tools }))
 * ```
 */
export function mcpMiddleware(config: McpMiddlewareConfig = {}): MiddlewareHandler {
  const server = new McpServer(config)

  return async (c, next) => {
    // Handle all MCP requests at this path
    return server.handleHttpRequest(c)
  }
}

// ============================================================================
// Type Exports
// ============================================================================

export type {
  McpMiddlewareConfig as McpConfig,
}
