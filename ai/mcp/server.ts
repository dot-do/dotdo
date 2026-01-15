/**
 * MCP Server for AI Module
 *
 * Provides a server implementation for exposing AI capabilities as MCP tools.
 * Integrates with the AI module's template literals and LLM router.
 *
 * @example
 * ```typescript
 * // Create server with AI tools
 * const server = createMcpServer({
 *   serverInfo: { name: 'my-ai-server', version: '1.0.0' },
 *   tools: [
 *     {
 *       tool: {
 *         name: 'summarize',
 *         description: 'Summarize text using AI',
 *         inputSchema: {
 *           type: 'object',
 *           properties: {
 *             text: { type: 'string', description: 'Text to summarize' },
 *           },
 *           required: ['text'],
 *         },
 *       },
 *       handler: async (params) => {
 *         const result = await summarize`${params.text}`
 *         return { content: [{ type: 'text', text: result }] }
 *       },
 *     },
 *   ],
 * })
 *
 * // Handle incoming request
 * const response = await server.handleRequest(request)
 * ```
 *
 * @module ai/mcp/server
 */

import type {
  McpTool,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPromptInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpServerOptions,
  ToolRegistration,
  ResourceRegistration,
  ToolHandler,
  ResourceHandler,
  ToolContext,
  ResourceContext,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types'
import {
  MCP_PROTOCOL,
  JSON_RPC_ERRORS,
  jsonRpcError,
  jsonRpcSuccess,
} from '../../types/mcp'

// ============================================================================
// Session Management
// ============================================================================

/**
 * MCP Server session
 */
interface ServerSession {
  id: string
  createdAt: Date
  lastAccessedAt: Date
  clientInfo?: { name: string; version: string }
  protocolVersion?: string
  subscriptions: Set<string>
}

// ============================================================================
// MCP Server Implementation
// ============================================================================

/**
 * MCP Server for exposing AI capabilities
 */
export class McpServer {
  private options: McpServerOptions
  private tools: Map<string, ToolRegistration> = new Map()
  private resources: Map<string, ResourceRegistration> = new Map()
  private resourcePatterns: Array<{ pattern: RegExp; registration: ResourceRegistration }> = []
  private prompts: Map<string, McpPromptInfo> = new Map()
  private sessions: Map<string, ServerSession> = new Map()

  constructor(options: McpServerOptions) {
    this.options = {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
      },
      sessionTimeout: 300000, // 5 minutes default
      maxSessions: 100,
      ...options,
    }

    // Register initial tools
    for (const registration of options.tools ?? []) {
      this.registerTool(registration)
    }

    // Register initial resources
    for (const registration of options.resources ?? []) {
      this.registerResource(registration)
    }

    // Register initial prompts
    for (const prompt of options.prompts ?? []) {
      this.prompts.set(prompt.name, prompt)
    }
  }

  // ============================================================================
  // Tool Management
  // ============================================================================

  /**
   * Register a new tool
   */
  registerTool(registration: ToolRegistration): void {
    this.tools.set(registration.tool.name, {
      ...registration,
      enabled: registration.enabled ?? true,
    })
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Get all registered tools
   */
  getTools(): McpTool[] {
    return Array.from(this.tools.values())
      .filter((r) => r.enabled !== false)
      .map((r) => r.tool)
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    const registration = this.tools.get(name)
    return registration !== undefined && registration.enabled !== false
  }

  /**
   * Enable or disable a tool
   */
  setToolEnabled(name: string, enabled: boolean): boolean {
    const registration = this.tools.get(name)
    if (registration) {
      registration.enabled = enabled
      return true
    }
    return false
  }

  // ============================================================================
  // Resource Management
  // ============================================================================

  /**
   * Register a new resource
   */
  registerResource(registration: ResourceRegistration): void {
    this.resources.set(registration.resource.uri, registration)

    // If pattern provided, compile and store for matching
    if (registration.pattern) {
      const pattern = this.compilePattern(registration.pattern)
      this.resourcePatterns.push({ pattern, registration })
    }
  }

  /**
   * Unregister a resource
   */
  unregisterResource(uri: string): boolean {
    const existed = this.resources.delete(uri)

    // Also remove from patterns
    this.resourcePatterns = this.resourcePatterns.filter(
      (p) => p.registration.resource.uri !== uri
    )

    return existed
  }

  /**
   * Get all registered resources
   */
  getResources(): McpResource[] {
    return Array.from(this.resources.values()).map((r) => r.resource)
  }

  /**
   * Compile a URI pattern to regex
   */
  private compilePattern(pattern: string): RegExp {
    // Convert glob-like pattern to regex
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }

  /**
   * Find resource handler for a URI
   */
  private findResourceHandler(uri: string): ResourceRegistration | undefined {
    // Check exact match first
    const exact = this.resources.get(uri)
    if (exact) {
      return exact
    }

    // Check patterns
    for (const { pattern, registration } of this.resourcePatterns) {
      if (pattern.test(uri)) {
        return registration
      }
    }

    return undefined
  }

  // ============================================================================
  // Prompt Management
  // ============================================================================

  /**
   * Register a prompt
   */
  registerPrompt(prompt: McpPromptInfo): void {
    this.prompts.set(prompt.name, prompt)
  }

  /**
   * Unregister a prompt
   */
  unregisterPrompt(name: string): boolean {
    return this.prompts.delete(name)
  }

  /**
   * Get all registered prompts
   */
  getPrompts(): McpPromptInfo[] {
    return Array.from(this.prompts.values())
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Get or create a session
   */
  private getOrCreateSession(sessionId: string | null): ServerSession {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!
      session.lastAccessedAt = new Date()
      return session
    }

    // Create new session
    const newSession: ServerSession = {
      id: sessionId ?? crypto.randomUUID(),
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      subscriptions: new Set(),
    }

    // Check max sessions
    if (this.sessions.size >= (this.options.maxSessions ?? 100)) {
      // Remove oldest session
      let oldestSession: ServerSession | null = null
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
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  // ============================================================================
  // Request Handling
  // ============================================================================

  /**
   * Handle an incoming HTTP request
   */
  async handleRequest(request: Request): Promise<Response> {
    const method = request.method

    // GET: SSE stream for notifications
    if (method === 'GET') {
      return this.handleSseStream(request)
    }

    // DELETE: Terminate session
    if (method === 'DELETE') {
      return this.handleDeleteSession(request)
    }

    // Only POST allowed for JSON-RPC
    if (method !== 'POST') {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Method not allowed')),
        {
          status: 405,
          headers: {
            'Content-Type': 'application/json',
            'Allow': 'GET, POST, DELETE',
          },
        }
      )
    }

    // Parse request body
    let body: JsonRpcRequest | JsonRpcRequest[]
    try {
      body = (await request.json()) as JsonRpcRequest | JsonRpcRequest[]
    } catch {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error')),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Get session
    const sessionId = request.headers.get('mcp-session-id') || request.headers.get('Mcp-Session-Id')

    // Handle batch requests
    const requests = Array.isArray(body) ? body : [body]
    const responses: JsonRpcResponse[] = []
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    let session: ServerSession | undefined
    let allNotifications = true

    for (const req of requests) {
      // Validate JSON-RPC format
      if (req.jsonrpc !== '2.0') {
        responses.push(
          jsonRpcError(req.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC version')
        )
        allNotifications = false
        continue
      }

      // Notifications have no id
      if (req.id === undefined) {
        continue
      }

      allNotifications = false

      // Handle method
      const result = await this.handleMethod(req, sessionId)
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
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: responseHeaders,
    })
  }

  /**
   * Handle SSE stream request
   */
  private handleSseStream(request: Request): Response {
    const sessionId = request.headers.get('mcp-session-id') || request.headers.get('Mcp-Session-Id')

    if (!sessionId) {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing Mcp-Session-Id header')),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (!this.sessions.has(sessionId)) {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found')),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
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
        'Connection': 'keep-alive',
        'Mcp-Session-Id': sessionId,
      },
    })
  }

  /**
   * Handle DELETE session request
   */
  private handleDeleteSession(request: Request): Response {
    const sessionId = request.headers.get('mcp-session-id') || request.headers.get('Mcp-Session-Id')

    if (!sessionId) {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Missing Mcp-Session-Id header')),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    if (!this.deleteSession(sessionId)) {
      return new Response(
        JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found')),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(null, { status: 204 })
  }

  /**
   * Handle a single MCP method
   */
  private async handleMethod(
    req: JsonRpcRequest,
    sessionId: string | null
  ): Promise<{ response: JsonRpcResponse; session?: ServerSession }> {
    // Methods that don't require session
    if (req.method === 'ping') {
      return { response: jsonRpcSuccess(req.id!, {}) }
    }

    if (req.method === 'initialize') {
      const params = req.params as {
        protocolVersion?: string
        clientInfo?: { name: string; version: string }
        capabilities?: Record<string, unknown>
      } | undefined

      const session = this.getOrCreateSession(sessionId)
      session.protocolVersion = params?.protocolVersion
      session.clientInfo = params?.clientInfo

      return {
        response: jsonRpcSuccess(req.id!, {
          protocolVersion: MCP_PROTOCOL.VERSION,
          capabilities: this.options.capabilities,
          serverInfo: this.options.serverInfo,
        }),
        session,
      }
    }

    // Methods that require session
    let session: ServerSession | undefined

    if (sessionId) {
      session = this.sessions.get(sessionId)
      if (!session) {
        return {
          response: jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found'),
        }
      }
      session.lastAccessedAt = new Date()
    } else {
      return {
        response: jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not initialized'),
      }
    }

    switch (req.method) {
      case 'tools/list':
        return {
          response: jsonRpcSuccess(req.id!, { tools: this.getTools() }),
          session,
        }

      case 'tools/call':
        return {
          response: await this.handleToolCall(req, session),
          session,
        }

      case 'resources/list':
        return {
          response: jsonRpcSuccess(req.id!, { resources: this.getResources() }),
          session,
        }

      case 'resources/read':
        return {
          response: await this.handleResourceRead(req, session),
          session,
        }

      case 'resources/subscribe': {
        const params = req.params as { uri?: string } | undefined
        if (params?.uri) {
          session.subscriptions.add(params.uri)
        }
        return {
          response: jsonRpcSuccess(req.id!, {}),
          session,
        }
      }

      case 'resources/unsubscribe': {
        const params = req.params as { uri?: string } | undefined
        if (params?.uri) {
          session.subscriptions.delete(params.uri)
        }
        return {
          response: jsonRpcSuccess(req.id!, {}),
          session,
        }
      }

      case 'prompts/list':
        return {
          response: jsonRpcSuccess(req.id!, { prompts: this.getPrompts() }),
          session,
        }

      case 'prompts/get':
        return {
          response: await this.handlePromptGet(req, session),
          session,
        }

      default:
        return {
          response: jsonRpcError(req.id!, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`),
          session,
        }
    }
  }

  /**
   * Handle tools/call method
   */
  private async handleToolCall(req: JsonRpcRequest, session: ServerSession): Promise<JsonRpcResponse> {
    const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined

    if (!params?.name) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name')
    }

    const registration = this.tools.get(params.name)
    if (!registration || registration.enabled === false) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Tool not found: ${params.name}`)
    }

    // Validate required arguments
    const toolArgs = params.arguments ?? {}
    const inputSchema = registration.tool.inputSchema as { required?: string[] } | undefined
    const requiredFields = inputSchema?.required ?? []

    for (const field of requiredFields) {
      if (!(field in toolArgs)) {
        return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, `Missing required argument: ${field}`)
      }
    }

    // Create context
    const context: ToolContext = {
      sessionId: session.id,
      metadata: {
        clientInfo: session.clientInfo,
      },
    }

    // Invoke handler
    try {
      const result = await registration.handler(toolArgs, context)
      return jsonRpcSuccess(req.id!, result)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return jsonRpcSuccess(req.id!, {
        content: [{ type: 'text', text: errorMessage }],
        isError: true,
      })
    }
  }

  /**
   * Handle resources/read method
   */
  private async handleResourceRead(req: JsonRpcRequest, session: ServerSession): Promise<JsonRpcResponse> {
    const params = req.params as { uri?: string } | undefined

    if (!params?.uri) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing resource URI')
    }

    const registration = this.findResourceHandler(params.uri)
    if (!registration) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, `Resource not found: ${params.uri}`)
    }

    // Parse URI
    let uriComponents: ResourceContext['uriComponents']
    try {
      const url = new URL(params.uri)
      uriComponents = {
        scheme: url.protocol.replace(':', ''),
        host: url.host,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
      }
    } catch {
      // Non-URL URI format
      const match = params.uri.match(/^([^:]+):\/\/([^/]*)(.*)$/)
      if (match) {
        uriComponents = {
          scheme: match[1]!,
          host: match[2]!,
          path: match[3]!,
        }
      } else {
        uriComponents = {
          scheme: 'unknown',
          host: '',
          path: params.uri,
        }
      }
    }

    // Create context
    const context: ResourceContext = {
      sessionId: session.id,
      uriComponents,
    }

    // Invoke handler
    try {
      const content = await registration.handler(params.uri, context)
      return jsonRpcSuccess(req.id!, { contents: [content] })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INTERNAL_ERROR, errorMessage)
    }
  }

  /**
   * Handle prompts/get method
   */
  private async handlePromptGet(req: JsonRpcRequest, _session: ServerSession): Promise<JsonRpcResponse> {
    const params = req.params as { name?: string; arguments?: Record<string, unknown> } | undefined

    if (!params?.name) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing prompt name')
    }

    const prompt = this.prompts.get(params.name)
    if (!prompt) {
      return jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, `Prompt not found: ${params.name}`)
    }

    // For now, just return a simple message
    // In the future, this could expand templates with arguments
    return jsonRpcSuccess(req.id!, {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Prompt: ${params.name}` },
        },
      ],
    })
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new MCP server
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  return new McpServer(options)
}

/**
 * Create a minimal MCP server with just tool handling
 */
export function createToolServer(
  serverInfo: McpServerInfo,
  tools: ToolRegistration[]
): McpServer {
  return new McpServer({
    serverInfo,
    tools,
    capabilities: {
      tools: { listChanged: true },
    },
  })
}

/**
 * Create request handler for Hono or other frameworks
 */
export function createMcpRequestHandler(server: McpServer) {
  return async (request: Request): Promise<Response> => {
    return server.handleRequest(request)
  }
}
