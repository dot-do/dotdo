/**
 * MCP Client for AI Module
 *
 * Provides a client implementation for connecting AI agents to MCP servers.
 * Supports multiple transport types (HTTP, WebSocket, stdio, Worker).
 *
 * @example
 * ```typescript
 * // Create HTTP client
 * const client = createMcpClient({
 *   clientInfo: { name: 'my-agent', version: '1.0.0' },
 *   transport: {
 *     type: 'http',
 *     url: 'https://mcp.example.com',
 *   },
 * })
 *
 * // Connect and initialize
 * await client.connect()
 *
 * // List available tools
 * const tools = await client.listTools()
 *
 * // Call a tool
 * const result = await client.callTool('search', { query: 'hello' })
 * ```
 *
 * @module ai/mcp/client
 */

import type {
  McpTool,
  McpToolResult,
  McpResource,
  McpResourceContent,
  McpPromptInfo,
  McpServerCapabilities,
  McpServerInfo,
  McpClientState,
  McpClientOptions,
  TransportConfig,
  HttpTransportConfig,
  ToolInvocationResult,
  PendingRequest,
  JsonRpcRequest,
  JsonRpcResponse,
} from './types'
import {
  MCP_PROTOCOL,
  jsonRpcError,
  jsonRpcSuccess,
  JSON_RPC_ERRORS,
} from '../../types/mcp'

// ============================================================================
// MCP Client Implementation
// ============================================================================

/**
 * MCP Client for connecting to MCP servers
 */
export class McpClient {
  private options: McpClientOptions
  private state: McpClientState = 'disconnected'
  private sessionId: string | null = null
  private serverInfo: McpServerInfo | null = null
  private serverCapabilities: McpServerCapabilities | null = null
  private tools: Map<string, McpTool> = new Map()
  private resources: Map<string, McpResource> = new Map()
  private prompts: Map<string, McpPromptInfo> = new Map()
  private pendingRequests: Map<string | number, PendingRequest> = new Map()
  private requestCounter = 0
  private eventListeners: Map<string, Set<Function>> = new Map()

  constructor(options: McpClientOptions) {
    this.options = options
  }

  // ============================================================================
  // Connection Lifecycle
  // ============================================================================

  /**
   * Get current client state
   */
  getState(): McpClientState {
    return this.state
  }

  /**
   * Get session ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * Get server info
   */
  getServerInfo(): McpServerInfo | null {
    return this.serverInfo
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): McpServerCapabilities | null {
    return this.serverCapabilities
  }

  /**
   * Connect to the MCP server and initialize session
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'initialized') {
      return
    }

    this.state = 'connecting'
    this.emit('stateChange', this.state)

    try {
      // Send initialize request
      const response = await this.sendRequest('initialize', {
        protocolVersion: MCP_PROTOCOL.VERSION,
        clientInfo: this.options.clientInfo,
        capabilities: this.options.requestedCapabilities ?? {},
      })

      if (response.error) {
        throw new Error(response.error.message)
      }

      const result = response.result as {
        protocolVersion: string
        serverInfo: McpServerInfo
        capabilities: McpServerCapabilities
      }

      this.serverInfo = result.serverInfo
      this.serverCapabilities = result.capabilities
      this.state = 'initialized'
      this.emit('stateChange', this.state)
      this.emit('connect')

      // Send initialized notification
      await this.sendNotification('notifications/initialized', {})

      // Fetch initial tool list
      await this.refreshTools()

      // Fetch initial resource list
      await this.refreshResources()
    } catch (error) {
      this.state = 'error'
      this.emit('stateChange', this.state)
      this.emit('error', error)
      throw error
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.state === 'disconnected') {
      return
    }

    // Cancel all pending requests
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle)
      }
      pending.reject(new Error('Client disconnected'))
    }
    this.pendingRequests.clear()

    this.state = 'disconnected'
    this.sessionId = null
    this.serverInfo = null
    this.serverCapabilities = null
    this.tools.clear()
    this.resources.clear()
    this.prompts.clear()

    this.emit('stateChange', this.state)
    this.emit('disconnect')
  }

  // ============================================================================
  // Tool Operations
  // ============================================================================

  /**
   * Refresh the list of available tools from the server
   */
  async refreshTools(): Promise<McpTool[]> {
    const response = await this.sendRequest('tools/list', {})

    if (response.error) {
      throw new Error(response.error.message)
    }

    const result = response.result as { tools?: McpTool[] } | undefined
    this.tools.clear()
    const tools = result?.tools ?? []
    for (const tool of tools) {
      this.tools.set(tool.name, tool)
    }

    this.emit('toolsChanged', Array.from(this.tools.values()))
    return tools
  }

  /**
   * Get cached list of tools
   */
  listTools(): McpTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): McpTool | undefined {
    return this.tools.get(name)
  }

  /**
   * Check if a tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Call a tool on the server
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolInvocationResult> {
    const startTime = Date.now()

    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    })

    const latencyMs = Date.now() - startTime

    if (response.error) {
      return {
        result: {
          content: [{ type: 'text', text: response.error.message }],
          isError: true,
        },
        latencyMs,
        tool: name,
        arguments: args,
      }
    }

    return {
      result: response.result as McpToolResult,
      latencyMs,
      tool: name,
      arguments: args,
    }
  }

  // ============================================================================
  // Resource Operations
  // ============================================================================

  /**
   * Refresh the list of available resources from the server
   */
  async refreshResources(): Promise<McpResource[]> {
    const response = await this.sendRequest('resources/list', {})

    if (response.error) {
      throw new Error(response.error.message)
    }

    const result = response.result as { resources?: McpResource[] } | undefined
    this.resources.clear()
    const resources = result?.resources ?? []
    for (const resource of resources) {
      this.resources.set(resource.uri, resource)
    }

    this.emit('resourcesChanged', Array.from(this.resources.values()))
    return resources
  }

  /**
   * Get cached list of resources
   */
  listResources(): McpResource[] {
    return Array.from(this.resources.values())
  }

  /**
   * Read a resource from the server
   */
  async readResource(uri: string): Promise<McpResourceContent[]> {
    const response = await this.sendRequest('resources/read', { uri })

    if (response.error) {
      throw new Error(response.error.message)
    }

    const result = response.result as { contents: McpResourceContent[] }
    return result.contents
  }

  /**
   * Subscribe to resource changes
   */
  async subscribeResource(uri: string): Promise<void> {
    const response = await this.sendRequest('resources/subscribe', { uri })

    if (response.error) {
      throw new Error(response.error.message)
    }
  }

  /**
   * Unsubscribe from resource changes
   */
  async unsubscribeResource(uri: string): Promise<void> {
    const response = await this.sendRequest('resources/unsubscribe', { uri })

    if (response.error) {
      throw new Error(response.error.message)
    }
  }

  // ============================================================================
  // Prompt Operations
  // ============================================================================

  /**
   * List available prompts
   */
  async listPrompts(): Promise<McpPromptInfo[]> {
    const response = await this.sendRequest('prompts/list', {})

    if (response.error) {
      throw new Error(response.error.message)
    }

    const result = response.result as { prompts: McpPromptInfo[] }
    this.prompts.clear()
    for (const prompt of result.prompts) {
      this.prompts.set(prompt.name, prompt)
    }

    return result.prompts
  }

  /**
   * Get a prompt with arguments
   */
  async getPrompt(name: string, args?: Record<string, unknown>): Promise<{ messages: unknown[] }> {
    const response = await this.sendRequest('prompts/get', {
      name,
      arguments: args,
    })

    if (response.error) {
      throw new Error(response.error.message)
    }

    return response.result as { messages: unknown[] }
  }

  // ============================================================================
  // Event Handling
  // ============================================================================

  /**
   * Add an event listener
   */
  on(event: string, listener: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(listener)
  }

  /**
   * Remove an event listener
   */
  off(event: string, listener: Function): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * Emit an event
   */
  private emit(event: string, ...args: unknown[]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(...args)
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error)
        }
      }
    }
  }

  // ============================================================================
  // Transport Layer
  // ============================================================================

  /**
   * Send a JSON-RPC request
   */
  private async sendRequest(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = ++this.requestCounter
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return this.sendViaTransport(request)
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  private async sendNotification(method: string, params: Record<string, unknown>): Promise<void> {
    const notification: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    }

    // For notifications, we don't wait for a response
    await this.sendViaTransport(notification)
  }

  /**
   * Send request via configured transport
   */
  private async sendViaTransport(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const transport = this.options.transport

    switch (transport.type) {
      case 'http':
        return this.sendViaHttp(transport, request)

      case 'websocket':
        throw new Error('WebSocket transport not yet implemented')

      case 'stdio':
        throw new Error('stdio transport not yet implemented - use cli/mcp-stdio.ts')

      case 'worker':
        return this.sendViaWorker(transport, request)

      default:
        throw new Error(`Unknown transport type: ${(transport as TransportConfig).type}`)
    }
  }

  /**
   * Send request via HTTP transport
   */
  private async sendViaHttp(config: HttpTransportConfig, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const fetchFn = config.fetch ?? fetch
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    }

    // Add session ID if available
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    const timeout = config.timeout ?? 30000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetchFn(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Extract session ID from response headers
      const responseSessionId = response.headers.get('Mcp-Session-Id')
      if (responseSessionId) {
        this.sessionId = responseSessionId
      }

      if (!response.ok) {
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: {
            code: JSON_RPC_ERRORS.INTERNAL_ERROR,
            message: `HTTP error: ${response.status} ${response.statusText}`,
          },
        }
      }

      return (await response.json()) as JsonRpcResponse
    } catch (error) {
      clearTimeout(timeoutId)

      if ((error as Error).name === 'AbortError') {
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: {
            code: JSON_RPC_ERRORS.INTERNAL_ERROR,
            message: 'Request timeout',
          },
        }
      }

      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: `Transport error: ${(error as Error).message}`,
        },
      }
    }
  }

  /**
   * Send request via Worker transport (Durable Object)
   */
  private async sendViaWorker(config: { type: 'worker'; binding: unknown; namespace?: string }, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Assume binding is a DurableObject stub with fetch method
    const stub = config.binding as { fetch: (request: Request) => Promise<Response> }

    const url = config.namespace
      ? `https://${config.namespace}.internal/mcp`
      : 'https://internal/mcp'

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId
    }

    try {
      const response = await stub.fetch(
        new Request(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
        })
      )

      // Extract session ID from response headers
      const responseSessionId = response.headers.get('Mcp-Session-Id')
      if (responseSessionId) {
        this.sessionId = responseSessionId
      }

      return (await response.json()) as JsonRpcResponse
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: `Worker error: ${(error as Error).message}`,
        },
      }
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new MCP client
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  return new McpClient(options)
}

/**
 * Create an HTTP MCP client with simplified configuration
 */
export function createHttpClient(url: string, clientInfo?: { name: string; version: string }): McpClient {
  return new McpClient({
    clientInfo: clientInfo ?? { name: 'dotdo-ai-client', version: '1.0.0' },
    transport: {
      type: 'http',
      url,
    },
  })
}

/**
 * Create a Worker MCP client for connecting to Durable Objects
 */
export function createWorkerClient(
  binding: unknown,
  options?: {
    namespace?: string
    clientInfo?: { name: string; version: string }
  }
): McpClient {
  return new McpClient({
    clientInfo: options?.clientInfo ?? { name: 'dotdo-ai-client', version: '1.0.0' },
    transport: {
      type: 'worker',
      binding,
      namespace: options?.namespace,
    },
  })
}
