/**
 * MCP Server Integration for Durable Objects
 *
 * Provides MCP (Model Context Protocol) support for DO classes.
 * Allows DO methods to be exposed as MCP tools and DO data as MCP resources.
 *
 * Features:
 * - Static $mcp configuration for tool/resource definitions
 * - JSON-RPC 2.0 protocol compliance
 * - Session management with Mcp-Session-Id header
 * - Auto-generated JSON schemas from tool configurations
 * - SSE stream support for server notifications
 *
 * @example
 * ```typescript
 * class MyDO extends DO {
 *   static $mcp = {
 *     tools: {
 *       search: {
 *         description: 'Search items',
 *         inputSchema: {
 *           query: { type: 'string', description: 'Search query' },
 *         },
 *         required: ['query'],
 *       },
 *     },
 *     resources: ['items', 'users'],
 *   }
 *
 *   search(query: string) {
 *     // Implementation
 *   }
 * }
 * ```
 */

// ============================================================================
// TYPES - Import from consolidated module
// ============================================================================

import type {
  McpTool as McpToolType,
  McpResource as McpResourceType,
  McpSession as McpSessionType,
  McpConfig as McpConfigType,
  McpToolConfig,
  JsonRpcRequest as JsonRpcRequestType,
  JsonRpcResponse as JsonRpcResponseType,
  JsonSchemaProperty,
} from '../../types/mcp'

import {
  JSON_RPC_ERRORS as MCP_JSON_RPC_ERRORS,
  jsonRpcError as mcpJsonRpcError,
  jsonRpcSuccess as mcpJsonRpcSuccess,
  MCP_PROTOCOL,
} from '../../types/mcp'

// Re-export types for backward compatibility
export type {
  McpToolType as McpTool,
  McpResourceType as McpResource,
  McpSessionType as McpSession,
  McpConfigType as McpConfig,
}

/**
 * Tool configuration in $mcp.tools
 * @deprecated Use McpToolConfig from types/mcp.ts
 */
export type ToolConfig = McpToolConfig

/**
 * JSON-RPC 2.0 Request
 * @deprecated Use JsonRpcRequest from types/mcp.ts
 */
export type JsonRpcRequest = JsonRpcRequestType

/**
 * JSON-RPC 2.0 Response
 * @deprecated Use JsonRpcResponse from types/mcp.ts
 */
export type JsonRpcResponse = JsonRpcResponseType

// Local type aliases for internal use
type McpTool = McpToolType
type McpResource = McpResourceType
type McpSession = McpSessionType
type McpConfig = McpConfigType

/**
 * DO instance type for MCP handler
 */
interface DOInstance {
  ns: string
  [key: string]: unknown
}

/**
 * DO class type with static $mcp config
 */
interface DOClass {
  new (...args: unknown[]): DOInstance
  $mcp?: McpConfig
  prototype: Record<string, unknown>
}

// ============================================================================
// JSON-RPC ERROR CODES - Re-export from consolidated module
// ============================================================================

export const JSON_RPC_ERRORS = MCP_JSON_RPC_ERRORS

// ============================================================================
// MCP PROTOCOL CONSTANTS
// ============================================================================

const MCP_PROTOCOL_VERSION = MCP_PROTOCOL.VERSION
const MCP_SERVER_NAME = 'dotdo-do-mcp-server'
const MCP_SERVER_VERSION = '0.1.0'

// ============================================================================
// HELPER FUNCTIONS - Use consolidated module helpers
// ============================================================================

const jsonRpcError = mcpJsonRpcError
const jsonRpcSuccess = mcpJsonRpcSuccess

// ============================================================================
// SCHEMA GENERATION
// ============================================================================

/**
 * Generate a JSON Schema from a tool configuration
 */
export function generateToolSchema(toolConfig: ToolConfig): McpTool['inputSchema'] {
  const properties: Record<string, { type: string; description?: string }> = {}

  for (const [name, config] of Object.entries(toolConfig.inputSchema)) {
    properties[name] = {
      type: config.type,
      ...(config.description && { description: config.description }),
    }
  }

  return {
    type: 'object',
    properties,
    ...(toolConfig.required && toolConfig.required.length > 0 && { required: toolConfig.required }),
  }
}

// ============================================================================
// TOOL AND RESOURCE DISCOVERY
// ============================================================================

/**
 * Get MCP tools from a DO class's $mcp configuration
 */
export function getMcpTools(DOClass: DOClass): McpTool[] {
  const config = DOClass.$mcp
  if (!config?.tools) {
    return []
  }

  const tools: McpTool[] = []

  for (const [name, toolConfig] of Object.entries(config.tools)) {
    tools.push({
      name,
      description: toolConfig.description,
      inputSchema: generateToolSchema(toolConfig),
    })
  }

  return tools
}

/**
 * Get MCP resources from a DO class's $mcp configuration
 */
export function getMcpResources(DOClass: DOClass, ns: string): McpResource[] {
  const config = DOClass.$mcp
  if (!config?.resources) {
    return []
  }

  // Parse the namespace URL to extract host
  let host = 'do'
  try {
    const url = new URL(ns)
    host = url.host
  } catch {
    // Use default host
  }

  return config.resources.map((resourceName) => ({
    uri: `do://${host}/${resourceName}`,
    name: resourceName,
    mimeType: 'application/json',
  }))
}

// ============================================================================
// MCP HANDLER FACTORY
// ============================================================================

/**
 * Create an MCP request handler for a DO class
 *
 * @param DOClass - The DO class with $mcp configuration
 * @returns A function that handles MCP requests
 */
export function createMcpHandler(DOClass: DOClass): (
  instance: DOInstance,
  request: Request,
  sessions: Map<string, McpSession>
) => Promise<Response> {
  const tools = getMcpTools(DOClass)
  const toolsByName = new Map(tools.map((t) => [t.name, t]))
  const toolConfigByName = new Map(
    Object.entries(DOClass.$mcp?.tools ?? {}).map(([name, config]) => [name, config])
  )

  return async function handleMcp(
    instance: DOInstance,
    request: Request,
    sessions: Map<string, McpSession>
  ): Promise<Response> {
    const method = request.method

    // GET: SSE stream for notifications
    if (method === 'GET') {
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

      const session = sessions.get(sessionId)
      if (!session) {
        return new Response(
          JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found')),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Return SSE stream
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

    // DELETE: Terminate session
    if (method === 'DELETE') {
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

      const deleted = sessions.delete(sessionId)
      if (!deleted) {
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
      return new Response(JSON.stringify(jsonRpcError(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get or validate session
    let sessionId = request.headers.get('mcp-session-id') || request.headers.get('Mcp-Session-Id')
    let currentSession: McpSession | undefined = sessionId ? sessions.get(sessionId) : undefined

    // Check if we need to validate session before processing
    // If session ID was provided but session not found, and request is not initialize/ping, return 404
    const requests = Array.isArray(body) ? body : [body]
    const firstRequest = requests[0]
    const firstMethod = firstRequest?.method

    // Define known MCP methods
    const knownMethods = new Set([
      'initialize',
      'ping',
      'tools/list',
      'tools/call',
      'resources/list',
      'resources/read',
      'prompts/list',
    ])

    // For non-notification requests (has id), check if the request is valid JSON-RPC
    // and if the method is known
    if (firstRequest?.id !== undefined) {
      // Check JSON-RPC version first
      if (firstRequest?.jsonrpc !== '2.0') {
        return new Response(
          JSON.stringify(jsonRpcError(firstRequest?.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid JSON-RPC version')),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Check for unknown method (before session check)
      if (firstMethod && !knownMethods.has(firstMethod)) {
        return new Response(
          JSON.stringify(jsonRpcError(firstRequest?.id ?? null, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${firstMethod}`)),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }
    }

    const requiresSession = firstMethod && firstMethod !== 'initialize' && firstMethod !== 'ping'

    // Only validate session for non-notification requests
    if (sessionId && !currentSession && requiresSession && firstRequest?.id !== undefined) {
      return new Response(
        JSON.stringify(jsonRpcError(firstRequest?.id ?? null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Session not found')),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Handle batch requests
    const responses: JsonRpcResponse[] = []
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Track if all requests are notifications
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

      // Notifications have no id - no response expected
      if (req.id === undefined) {
        // Process notification but don't add to responses
        continue
      }

      allNotifications = false

      // Handle MCP methods
      const response = await handleMcpMethod(
        req,
        instance,
        DOClass,
        sessions,
        sessionId,
        currentSession,
        tools,
        toolsByName,
        toolConfigByName
      )

      // Update session reference if created
      if (response.session) {
        currentSession = response.session
        sessionId = response.session.id
      }

      responses.push(response.response)
    }

    // If all requests were notifications, return 204
    if (allNotifications && responses.length === 0) {
      return new Response(null, { status: 204 })
    }

    // If session was created/used, include it in response headers
    if (currentSession) {
      responseHeaders['Mcp-Session-Id'] = currentSession.id
    }

    // Return single response or batch
    const responseBody = Array.isArray(body) ? responses : responses[0]
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: responseHeaders,
    })
  }
}

/**
 * Handle a single MCP method call
 */
async function handleMcpMethod(
  req: JsonRpcRequest,
  instance: DOInstance,
  DOClass: DOClass,
  sessions: Map<string, McpSession>,
  sessionId: string | null,
  currentSession: McpSession | undefined,
  tools: McpTool[],
  toolsByName: Map<string, McpTool>,
  toolConfigByName: Map<string, ToolConfig>
): Promise<{ response: JsonRpcResponse; session?: McpSession }> {
  // Methods that don't require session
  if (req.method === 'ping') {
    return { response: jsonRpcSuccess(req.id!, {}) }
  }

  if (req.method === 'initialize') {
    // Create new session if not exists
    if (!currentSession) {
      const newSession: McpSession = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        protocolVersion: MCP_PROTOCOL_VERSION,
      }

      const params = req.params as { clientInfo?: { name: string; version: string } } | undefined
      if (params?.clientInfo) {
        newSession.clientInfo = params.clientInfo
      }

      sessions.set(newSession.id, newSession)
      currentSession = newSession
    }

    return {
      response: jsonRpcSuccess(req.id!, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true, listChanged: true },
          prompts: { listChanged: true },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
      }),
      session: currentSession,
    }
  }

  // Methods that require session
  if (req.method !== 'initialize' && req.method !== 'ping') {
    // Check if session ID was provided but session not found
    if (sessionId && !currentSession) {
      return {
        response: jsonRpcError(
          req.id!,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Session not found'
        ),
      }
    }

    // Check if session is required but not provided
    if (!currentSession) {
      return {
        response: jsonRpcError(
          req.id!,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          'Session not initialized'
        ),
      }
    }
  }

  switch (req.method) {
    case 'tools/list': {
      return {
        response: jsonRpcSuccess(req.id!, { tools }),
        session: currentSession,
      }
    }

    case 'tools/call': {
      const params = req.params as { name: string; arguments?: Record<string, unknown> } | undefined
      if (!params?.name) {
        return {
          response: jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name'),
          session: currentSession,
        }
      }

      const tool = toolsByName.get(params.name)
      if (!tool) {
        return {
          response: jsonRpcError(
            req.id!,
            JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            `Tool not found: ${params.name}`
          ),
          session: currentSession,
        }
      }

      // Validate required arguments
      const toolConfig = toolConfigByName.get(params.name)
      const toolArgs = params.arguments || {}
      const requiredFields = toolConfig?.required || []

      for (const field of requiredFields) {
        if (!(field in toolArgs)) {
          return {
            response: jsonRpcError(
              req.id!,
              JSON_RPC_ERRORS.INVALID_PARAMS,
              `Missing required argument: ${field}`
            ),
            session: currentSession,
          }
        }
      }

      // Invoke the method on the DO instance
      try {
        const methodFn = instance[params.name]
        if (typeof methodFn !== 'function') {
          return {
            response: jsonRpcError(
              req.id!,
              JSON_RPC_ERRORS.METHOD_NOT_FOUND,
              `Method not found: ${params.name}`
            ),
            session: currentSession,
          }
        }

        // Build arguments array from schema order
        const argNames = Object.keys(toolConfig?.inputSchema || {})
        const args = argNames.map((name) => toolArgs[name])

        const result = await (methodFn as Function).apply(instance, args)
        const resultText = typeof result === 'string' ? result : JSON.stringify(result)

        return {
          response: jsonRpcSuccess(req.id!, {
            content: [{ type: 'text', text: resultText }],
          }),
          session: currentSession,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return {
          response: jsonRpcSuccess(req.id!, {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          }),
          session: currentSession,
        }
      }
    }

    case 'resources/list': {
      const resources = getMcpResources(DOClass, instance.ns)
      return {
        response: jsonRpcSuccess(req.id!, { resources }),
        session: currentSession,
      }
    }

    case 'resources/read': {
      const params = req.params as { uri: string } | undefined
      if (!params?.uri) {
        return {
          response: jsonRpcError(req.id!, JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing resource URI'),
          session: currentSession,
        }
      }

      // Parse URI: do://host/resourceName or do://host/resourceName/id
      const uriMatch = params.uri.match(/^do:\/\/([^/]+)\/([^/]+)(?:\/(.+))?$/)
      if (!uriMatch) {
        return {
          response: jsonRpcError(
            req.id!,
            JSON_RPC_ERRORS.INVALID_PARAMS,
            `Invalid resource URI: ${params.uri}`
          ),
          session: currentSession,
        }
      }

      const [, , resourceName, resourceId] = uriMatch
      const safeResourceName = resourceName!

      // Check if resource is defined in $mcp.resources
      const configResources = DOClass.$mcp?.resources || []
      if (!configResources.includes(safeResourceName)) {
        return {
          response: jsonRpcError(
            req.id!,
            JSON_RPC_ERRORS.INVALID_PARAMS,
            `Resource not found: ${safeResourceName}`
          ),
          session: currentSession,
        }
      }

      // Try to get the resource data from the DO instance
      // First, check for a getter method like getItems(), getUsers(), etc.
      const getterName = `get${safeResourceName.charAt(0).toUpperCase()}${safeResourceName.slice(1)}`
      const getter = instance[getterName]

      let data: unknown

      if (typeof getter === 'function') {
        const allData = await (getter as Function).call(instance)

        if (resourceId) {
          // Filter to specific item
          if (Array.isArray(allData)) {
            data = allData.find((item: { id?: string }) => item.id === resourceId)
            if (!data) {
              return {
                response: jsonRpcError(
                  req.id!,
                  JSON_RPC_ERRORS.INVALID_PARAMS,
                  `Resource item not found: ${safeResourceName}/${resourceId}`
                ),
                session: currentSession,
              }
            }
          } else {
            data = allData
          }
        } else {
          data = allData
        }
      } else {
        // Try direct property access
        const prop = instance[safeResourceName]
        if (prop !== undefined) {
          data = prop
        } else {
          return {
            response: jsonRpcError(
              req.id!,
              JSON_RPC_ERRORS.INVALID_PARAMS,
              `Resource accessor not found: ${safeResourceName}`
            ),
            session: currentSession,
          }
        }
      }

      return {
        response: jsonRpcSuccess(req.id!, {
          contents: [
            {
              uri: params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(data),
            },
          ],
        }),
        session: currentSession,
      }
    }

    case 'prompts/list': {
      return {
        response: jsonRpcSuccess(req.id!, { prompts: [] }),
        session: currentSession,
      }
    }

    default:
      return {
        response: jsonRpcError(
          req.id!,
          JSON_RPC_ERRORS.METHOD_NOT_FOUND,
          `Method not found: ${req.method}`
        ),
        session: currentSession,
      }
  }
}

// ============================================================================
// MCP MIXIN FOR DO CLASSES
// ============================================================================

/**
 * MCP session storage per DO instance
 */
const mcpSessions = new WeakMap<object, Map<string, McpSession>>()

/**
 * Get or create session storage for a DO instance
 */
function getSessionStorage(instance: object): Map<string, McpSession> {
  let sessions = mcpSessions.get(instance)
  if (!sessions) {
    sessions = new Map()
    mcpSessions.set(instance, sessions)
  }
  return sessions
}

/**
 * Add handleMcp method to a DO instance
 * This is called internally to attach MCP support to DO classes
 */
export function attachMcpHandler(instance: DOInstance, DOClass: DOClass): void {
  const handler = createMcpHandler(DOClass)
  const sessions = getSessionStorage(instance)

  // Attach handleMcp method to instance
  ;(instance as unknown as { handleMcp: (request: Request) => Promise<Response> }).handleMcp =
    async function (request: Request): Promise<Response> {
      return handler(instance, request, sessions)
    }
}

/**
 * Type guard to check if a DO class has $mcp configuration
 */
export function hasMcpConfig(DOClass: DOClass): boolean {
  return DOClass.$mcp !== undefined && (
    (DOClass.$mcp.tools !== undefined && Object.keys(DOClass.$mcp.tools).length > 0) ||
    (DOClass.$mcp.resources !== undefined && DOClass.$mcp.resources.length > 0)
  )
}

// ============================================================================
// MCP HANDLER - TransportHandler Implementation
// ============================================================================

import type {
  TransportHandler,
  HandlerContext,
  CanHandleResult,
  HandlerOptions,
} from './handler'
import {
  parseJsonBody,
  buildJsonResponse,
  buildErrorResponse,
} from './shared'

/**
 * MCP Handler options
 */
export interface McpHandlerOptions extends HandlerOptions {
  /** Path prefix for MCP endpoint (default: /mcp) */
  path?: string
}

/**
 * Cache for MCP tools per DO class
 */
const mcpToolsCache = new Map<Function, McpTool[]>()

/**
 * MCP (Model Context Protocol) Handler implementing TransportHandler interface
 *
 * Provides JSON-RPC 2.0 based MCP support:
 * - Tool discovery and invocation
 * - Resource listing and reading
 * - Session management
 * - SSE streaming for notifications
 *
 * @example
 * ```typescript
 * const mcpHandler = new McpHandler({
 *   path: '/mcp',
 *   debug: true,
 * })
 *
 * // Use in handler chain (higher priority than REST)
 * chain.use(mcpHandler, 50)
 * ```
 */
export class McpHandler implements TransportHandler {
  readonly name = 'mcp'
  private options: McpHandlerOptions
  private sessions: Map<string, McpSession> = new Map()
  private handler: ((instance: DOInstance, request: Request, sessions: Map<string, McpSession>) => Promise<Response>) | null = null
  private DOClass: DOClass | null = null

  constructor(options: McpHandlerOptions = {}) {
    this.options = {
      path: '/mcp',
      ...options,
    }
  }

  /**
   * Check if this handler can process the request
   * MCP handler processes requests to the /mcp endpoint
   */
  canHandle(request: Request): CanHandleResult {
    const url = new URL(request.url)
    const mcpPath = this.options.path || '/mcp'

    // Check if request is to MCP endpoint
    if (url.pathname === mcpPath || url.pathname.startsWith(`${mcpPath}/`)) {
      // MCP handler has higher priority than REST
      return {
        canHandle: true,
        priority: 50,
      }
    }

    return { canHandle: false, reason: 'Path does not match MCP endpoint' }
  }

  /**
   * Handle the MCP request
   */
  async handle(request: Request, context: HandlerContext): Promise<Response> {
    // Initialize handler if needed
    if (!this.handler || this.needsHandlerRefresh(context)) {
      this.initializeHandler(context)
    }

    if (!this.handler) {
      return buildErrorResponse(
        { message: 'MCP handler not initialized', code: 'HANDLER_NOT_INITIALIZED' },
        500
      )
    }

    const instance = context.instance as DOInstance
    return this.handler(instance, request, this.sessions)
  }

  /**
   * Check if handler needs refresh
   */
  private needsHandlerRefresh(context: HandlerContext): boolean {
    if (!this.DOClass) return true
    return this.DOClass !== context.instance.constructor
  }

  /**
   * Initialize the MCP handler from context
   */
  private initializeHandler(context: HandlerContext): void {
    this.DOClass = context.instance.constructor as DOClass
    this.handler = createMcpHandler(this.DOClass)
  }

  /**
   * Get cached tools for a DO class
   */
  static getCachedTools(DOClass: DOClass): McpTool[] {
    if (mcpToolsCache.has(DOClass)) {
      return mcpToolsCache.get(DOClass)!
    }

    const tools = getMcpTools(DOClass)
    mcpToolsCache.set(DOClass, tools)
    return tools
  }

  /**
   * Clear tools cache
   */
  static clearCache(): void {
    mcpToolsCache.clear()
  }

  /**
   * Get active sessions
   */
  getSessions(): Map<string, McpSession> {
    return this.sessions
  }

  /**
   * Clear all sessions
   */
  clearSessions(): void {
    this.sessions.clear()
  }

  /**
   * Dispose handler resources
   */
  dispose(): void {
    this.sessions.clear()
    this.handler = null
    this.DOClass = null
  }
}

// ============================================================================
// GRAPH INTEGRATION
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
 */
export interface ToolThingData {
  id: string
  description: string
  parameters: ToolParameter[]
  handler?: string
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

/**
 * GraphStore interface for type safety (minimal subset needed).
 * Full interface is in db/graph/types.ts.
 */
interface GraphStoreMinimal {
  getThingsByType(options: { typeName?: string; typeId?: number }): Promise<Array<{
    id: string
    typeId: number
    typeName: string
    data: Record<string, unknown> | null
    createdAt: number
    updatedAt: number
    deletedAt: number | null
  }>>
  createRelationship(input: {
    id: string
    verb: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: Date
  }>
  queryRelationshipsFrom(url: string, options?: { verb?: string }): Promise<Array<{
    id: string
    verb: string
    from: string
    to: string
    data: Record<string, unknown> | null
    createdAt: Date
  }>>
}

/**
 * Convert a Tool Thing from the graph to MCP tool format.
 *
 * @param toolThing - The GraphThing representing a Tool
 * @returns MCP tool definition
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

  const properties: Record<string, { type: string; description?: string }> = {}
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
 * Discover MCP tools from graph-stored Tool Things.
 *
 * Queries the graph for Things with typeName='Tool' and converts them
 * to MCP tool format.
 *
 * @param graph - GraphStore implementation to query
 * @param query - Optional filters for tool discovery
 * @returns Array of MCP tools discovered from the graph
 *
 * @example
 * ```typescript
 * const tools = await getMcpToolsFromGraph(graphStore)
 * // Returns all Tool Things as MCP tools
 *
 * const filtered = await getMcpToolsFromGraph(graphStore, { idPrefix: 'search' })
 * // Returns only tools with IDs starting with 'search'
 * ```
 */
export async function getMcpToolsFromGraph(
  graph: GraphStoreMinimal,
  query?: ToolQuery
): Promise<McpTool[]> {
  try {
    // Query Tool Things from graph
    const toolThings = await graph.getThingsByType({ typeName: 'Tool' })

    // Filter by query options
    let filtered = toolThings

    if (query?.idPrefix) {
      filtered = filtered.filter((t) => {
        const data = t.data as unknown as ToolThingData | null
        return data?.id?.startsWith(query.idPrefix!) ?? false
      })
    }

    if (query?.ids) {
      const idSet = new Set(query.ids)
      filtered = filtered.filter((t) => {
        const data = t.data as unknown as ToolThingData | null
        return data?.id ? idSet.has(data.id) : false
      })
    }

    // Convert to MCP format
    return filtered.map(toolThingToMcp)
  } catch {
    // Return empty array on error (graceful degradation)
    return []
  }
}

/**
 * Merge tools from static config and graph.
 *
 * Static config tools take precedence over graph tools with the same name.
 * This ensures backward compatibility while allowing dynamic tool discovery.
 *
 * @param staticTools - Tools from $mcp.tools static configuration
 * @param graph - Optional GraphStore for additional tool discovery
 * @returns Merged array of MCP tools
 *
 * @example
 * ```typescript
 * const merged = await getMergedMcpTools(staticTools, graphStore)
 * // Returns combined tools, static config wins on duplicates
 *
 * const backward = await getMergedMcpTools(staticTools, undefined)
 * // Returns only static tools (backward compatible)
 * ```
 */
export async function getMergedMcpTools(
  staticTools: McpTool[],
  graph: GraphStoreMinimal | undefined
): Promise<McpTool[]> {
  // Start with static tools
  const toolsByName = new Map<string, McpTool>()

  for (const tool of staticTools) {
    toolsByName.set(tool.name, tool)
  }

  // Add graph tools (only if not already defined)
  if (graph) {
    const graphTools = await getMcpToolsFromGraph(graph)

    for (const tool of graphTools) {
      if (!toolsByName.has(tool.name)) {
        toolsByName.set(tool.name, tool)
      }
    }
  }

  return Array.from(toolsByName.values())
}

// ============================================================================
// INVOCATION TRACKING
// ============================================================================

/**
 * Input for tracking a tool invocation.
 */
export interface TrackInvocationInput {
  /** Session ID making the invocation */
  sessionId: string
  /** Tool ID being invoked */
  toolId: string
  /** Input arguments to the tool */
  input: Record<string, unknown>
}

/**
 * Input for completing a tool invocation.
 */
export interface CompleteInvocationInput {
  /** Result from successful execution */
  result?: unknown
  /** Error message if execution failed */
  error?: string
  /** Duration in milliseconds */
  duration: number
}

/**
 * Track a tool invocation by creating a relationship in the graph.
 *
 * Creates an 'invoke' relationship from the session to the tool with
 * input data and timestamp.
 *
 * @param graph - GraphStore to record the invocation
 * @param input - Invocation details (session, tool, input)
 * @returns The created relationship
 *
 * @example
 * ```typescript
 * const invocation = await trackToolInvocation(graph, {
 *   sessionId: 'session-123',
 *   toolId: 'tool-search',
 *   input: { query: 'hello' }
 * })
 * // Creates: session-123 --invoke--> tool-search
 * ```
 */
export async function trackToolInvocation(
  graph: GraphStoreMinimal,
  input: TrackInvocationInput
): Promise<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}> {
  const invocationId = `inv-${crypto.randomUUID()}`
  const startedAt = Date.now()

  return graph.createRelationship({
    id: invocationId,
    verb: 'invoke',
    from: `do://sessions/${input.sessionId}`,
    to: input.toolId,
    data: {
      input: input.input,
      startedAt,
    },
  })
}

/**
 * Complete a tool invocation by updating the relationship with results.
 *
 * Changes the verb from 'invoke' to 'invoked' and adds output/error data.
 *
 * Note: Since GraphStore doesn't support relationship updates, we create
 * a new 'invoked' relationship that supersedes the original 'invoke'.
 *
 * @param graph - GraphStore to record the completion
 * @param invocationId - Original invocation relationship ID
 * @param completion - Result or error details
 * @returns The completed relationship
 *
 * @example
 * ```typescript
 * const completed = await completeToolInvocation(graph, invocationId, {
 *   result: { items: [...] },
 *   duration: 150
 * })
 * ```
 */
export async function completeToolInvocation(
  graph: GraphStoreMinimal,
  invocationId: string,
  completion: CompleteInvocationInput
): Promise<{
  id: string
  verb: string
  from: string
  to: string
  data: Record<string, unknown> | null
  createdAt: Date
}> {
  // Get the original invocation to preserve context
  // Since we can't update relationships, we create a new 'invoked' record
  const completedId = `${invocationId}-completed`

  const data: Record<string, unknown> = {
    duration: completion.duration,
  }

  if (completion.result !== undefined) {
    data.output = completion.result
  }

  if (completion.error !== undefined) {
    data.error = completion.error
  }

  return graph.createRelationship({
    id: completedId,
    verb: 'invoked',
    from: `do://invocations/${invocationId}`,
    to: `do://invocations/${invocationId}`,
    data,
  })
}
