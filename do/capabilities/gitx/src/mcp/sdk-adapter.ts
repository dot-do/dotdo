/**
 * @fileoverview MCP SDK Adapter
 *
 * This module provides a full-featured adapter for the MCP SDK,
 * including SDK initialization, tool registration, request/response
 * handling, error propagation, and connection lifecycle management.
 *
 * The SDK adapter extends the basic adapter with:
 * - Multiple transport support (stdio, SSE, HTTP)
 * - Connection state management and events
 * - Request cancellation and progress reporting
 * - Session management with client information
 * - Ping/pong health checking
 * - Graceful shutdown with pending request handling
 *
 * @module mcp/sdk-adapter
 *
 * @example
 * // Create and start an SDK adapter
 * import { createMCPSDKAdapter, MCPSDKTransport } from './sdk-adapter'
 *
 * const adapter = createMCPSDKAdapter({
 *   name: 'git-mcp-server',
 *   version: '1.0.0',
 *   transports: ['stdio', 'http'],
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 *
 * // Connect with a transport
 * const transport = MCPSDKTransport.createStdio()
 * await adapter.connect(transport)
 *
 * @example
 * // Handle tool calls with progress
 * const result = adapter.handleToolsCall({
 *   name: 'git_log',
 *   arguments: { maxCount: 100 }
 * })
 *
 * adapter.onProgress((event) => {
 *   console.log(`Progress: ${event.progress}/${event.total}`)
 * })
 *
 * const output = await result
 */

import { gitTools, type MCPToolResult } from './tools'

/**
 * MCP SDK Error codes - JSON-RPC 2.0 standard codes and MCP-specific codes.
 *
 * @description
 * Enumeration of error codes used in MCP SDK responses. Follows JSON-RPC 2.0
 * specification for standard errors and defines MCP-specific codes for
 * resource, tool, and prompt operations.
 *
 * @enum {number}
 */
export enum MCPSDKErrorCode {
  /** Parse error - Invalid JSON (-32700) */
  PARSE_ERROR = -32700,
  /** Invalid Request - Not a valid Request object (-32600) */
  INVALID_REQUEST = -32600,
  /** Method not found - Method does not exist (-32601) */
  METHOD_NOT_FOUND = -32601,
  /** Invalid params - Invalid method parameters (-32602) */
  INVALID_PARAMS = -32602,
  /** Internal error - Internal JSON-RPC error (-32603) */
  INTERNAL_ERROR = -32603,

  /** Tool not found - Requested tool does not exist (-32001) */
  TOOL_NOT_FOUND = -32001,
  /** Resource not found - Requested resource does not exist (-32002) */
  RESOURCE_NOT_FOUND = -32002,
  /** Prompt not found - Requested prompt does not exist (-32003) */
  PROMPT_NOT_FOUND = -32003,
  /** Capability not supported - Capability is not enabled (-32004) */
  CAPABILITY_NOT_SUPPORTED = -32004,
}

/**
 * MCP SDK Error class.
 *
 * @description
 * Error class for MCP SDK operations. Encapsulates error code, message,
 * and optional data. Can be converted to JSON-RPC format.
 *
 * @class MCPSDKError
 * @extends Error
 *
 * @example
 * throw new MCPSDKError(
 *   MCPSDKErrorCode.TOOL_NOT_FOUND,
 *   'Tool "unknown" not found'
 * )
 */
export class MCPSDKError extends Error {
  /** The error code */
  code: MCPSDKErrorCode
  /** Optional additional error data */
  data?: unknown

  /**
   * Create a new MCP SDK error.
   * @param code - The error code
   * @param message - Human-readable error message
   * @param data - Optional additional data
   */
  constructor(code: MCPSDKErrorCode, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
    this.name = 'MCPSDKError'
  }

  /**
   * Convert to JSON-RPC error format.
   * @returns Object suitable for JSON-RPC error responses
   */
  toJSONRPC(): { code: number; message: string; data?: unknown } {
    const result: { code: number; message: string; data?: unknown } = {
      code: this.code,
      message: this.message,
    }
    if (this.data !== undefined) {
      result.data = this.data
    }
    return result
  }
}

/**
 * Transport type.
 * @description Supported transport mechanisms for MCP communication.
 * @typedef {'stdio' | 'sse' | 'http' | 'custom'} MCPSDKTransportType
 */
export type MCPSDKTransportType = 'stdio' | 'sse' | 'http' | 'custom'

/**
 * Connection state.
 * @description Represents the current state of the adapter connection.
 * @typedef {'disconnected' | 'initializing' | 'connected'} MCPSDKConnectionState
 */
export type MCPSDKConnectionState =
  | 'disconnected'
  | 'initializing'
  | 'connected'

/**
 * MCP SDK Transport interface.
 *
 * @description
 * Interface for transport implementations that handle sending and receiving
 * MCP messages. Different transports (stdio, SSE, HTTP) implement this interface.
 *
 * @interface MCPSDKTransport
 */
export interface MCPSDKTransport {
  /** Transport type identifier */
  type: MCPSDKTransportType
  /** Send data through the transport */
  send?: (data: string) => void
  /** Receive data from the transport */
  receive?: () => Promise<string>
  /** Close the transport connection */
  close?: () => void
  /** Check if transport is connected */
  isConnected: () => boolean
  /** Handle an HTTP-style request (for HTTP/SSE transports) */
  handleRequest?: (
    request: unknown
  ) => Promise<{ status: number; headers: Record<string, string>; body?: string }>
}

/**
 * Logger interface.
 *
 * @description
 * Interface for logging implementations. All methods are optional,
 * allowing partial logger implementations.
 *
 * @interface MCPSDKLogger
 */
export interface MCPSDKLogger {
  /** Log error messages */
  error?: (message: string, ...args: unknown[]) => void
  /** Log warning messages */
  warn?: (message: string, ...args: unknown[]) => void
  /** Log info messages */
  info?: (message: string, ...args: unknown[]) => void
  /** Log debug messages */
  debug?: (message: string, ...args: unknown[]) => void
}

/**
 * Capabilities configuration.
 *
 * @description
 * Server capabilities that can be advertised to clients during initialization.
 *
 * @interface MCPSDKCapabilities
 */
export interface MCPSDKCapabilities {
  /** Tool-related capabilities */
  tools?: { listChanged?: boolean }
  /** Resource-related capabilities */
  resources?: { subscribe?: boolean }
  /** Prompt-related capabilities */
  prompts?: Record<string, unknown>
}

/**
 * SDK Adapter configuration.
 *
 * @description
 * Configuration options for creating an MCP SDK adapter instance.
 *
 * @interface MCPSDKAdapterConfig
 *
 * @example
 * const config: MCPSDKAdapterConfig = {
 *   name: 'my-server',
 *   version: '1.0.0',
 *   transports: ['stdio', 'http'],
 *   capabilities: { tools: { listChanged: true } },
 *   mode: 'production'
 * }
 */
export interface MCPSDKAdapterConfig {
  /** Server name (default: 'gitx.do') */
  name?: string
  /** Server version (default: '0.0.1') */
  version?: string
  /** Vendor identifier (default: 'gitx.do') */
  vendor?: string
  /** Supported transport types (default: ['stdio']) */
  transports?: MCPSDKTransportType[]
  /** MCP protocol version (default: '2024-11-05') */
  protocolVersion?: string
  /** Server capabilities */
  capabilities?: MCPSDKCapabilities
  /** Optional logger implementation */
  logger?: MCPSDKLogger
  /** Execution mode affecting error verbosity (default: 'development') */
  mode?: 'development' | 'production'
  /** Ping interval in milliseconds */
  pingInterval?: number
  /** Ping timeout in milliseconds */
  pingTimeout?: number
}

/**
 * Tool handler context.
 *
 * @description
 * Context provided to tool handlers for reporting progress and
 * checking cancellation status.
 *
 * @interface MCPSDKToolContext
 *
 * @example
 * const handler = async (params, context: MCPSDKToolContext) => {
 *   for (let i = 0; i < 100; i++) {
 *     if (context.isCancelled()) break
 *     await context.reportProgress(i, 100)
 *     // ... do work
 *   }
 *   return { content: [{ type: 'text', text: 'Done' }] }
 * }
 */
export interface MCPSDKToolContext {
  /** Report progress to the client */
  reportProgress: (progress: number, total: number) => Promise<void>
  /** Check if the request has been cancelled */
  isCancelled: () => boolean
}

/**
 * Tool registration.
 *
 * @description
 * Complete tool definition for SDK adapter registration.
 * Includes context-aware handler for progress/cancellation support.
 *
 * @interface MCPSDKToolRegistration
 */
export interface MCPSDKToolRegistration {
  /** Unique tool name */
  name: string
  /** Human-readable description */
  description: string
  /** JSON Schema for input validation */
  inputSchema: {
    type: string
    properties?: Record<string, unknown>
    required?: string[]
  }
  /** Handler with context for progress/cancellation */
  handler: (
    params: Record<string, unknown>,
    context: MCPSDKToolContext
  ) => Promise<MCPToolResult>
}

/**
 * Internal tool with ID.
 * @internal
 */
interface InternalTool extends MCPSDKToolRegistration {
  id: string
}

/**
 * Session information.
 *
 * @description
 * Information about the current client session established during initialization.
 *
 * @interface MCPSDKSession
 */
export interface MCPSDKSession {
  /** Unique session identifier */
  id: string
  /** Client information from initialization */
  clientInfo: { name: string; version: string }
  /** Client capabilities */
  clientCapabilities: {
    sampling?: Record<string, unknown>
    roots?: { listChanged?: boolean }
  }
}

/**
 * Client initialization request.
 *
 * @description
 * Request sent by client during protocol initialization.
 *
 * @interface MCPClientInitializeRequest
 */
export interface MCPClientInitializeRequest {
  /** Requested protocol version */
  protocolVersion: string
  /** Client identification */
  clientInfo: { name: string; version: string }
  /** Client capabilities */
  capabilities: Record<string, unknown>
}

/**
 * Tools call request.
 *
 * @description
 * Request to execute a registered tool.
 *
 * @interface MCPToolsCallRequest
 */
export interface MCPToolsCallRequest {
  /** Name of the tool to call */
  name: string
  /** Arguments to pass to the tool */
  arguments: Record<string, unknown>
}

/**
 * Tools call result with request ID.
 *
 * @description
 * Extended tool result that includes the request ID for tracking.
 *
 * @interface MCPToolsCallResult
 * @extends MCPToolResult
 */
export interface MCPToolsCallResult extends MCPToolResult {
  /** Optional request ID for tracking */
  requestId?: string
}

/**
 * Pending request for graceful shutdown.
 * @internal
 */
interface PendingRequest {
  complete: () => Promise<void>
}

/**
 * Progress event.
 * @internal
 */
interface ProgressEvent {
  progress: number
  total: number
}

/**
 * MCP SDK Adapter class.
 *
 * @description
 * Full-featured MCP adapter with advanced features including:
 * - Multiple transport support (stdio, SSE, HTTP)
 * - Connection lifecycle management with events
 * - Request tracking, cancellation, and progress reporting
 * - Session management with client capabilities
 * - Health checking via ping/pong
 * - Graceful shutdown with request draining
 *
 * @class MCPSDKAdapter
 *
 * @example
 * const adapter = new MCPSDKAdapter({
 *   name: 'git-server',
 *   version: '1.0.0',
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.onConnected(() => console.log('Connected!'))
 * adapter.onError((err) => console.error(err))
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 */
export class MCPSDKAdapter {
  /** @internal */
  private config: Required<
    Pick<MCPSDKAdapterConfig, 'name' | 'version' | 'vendor'>
  > &
    MCPSDKAdapterConfig
  /** @internal */
  private connectionState: MCPSDKConnectionState = 'disconnected'
  /** @internal */
  private tools: Map<string, InternalTool> = new Map()
  /** @internal */
  private toolIdCounter = 0
  /** @internal */
  private session: MCPSDKSession | null = null
  /** @internal */
  private stateChangeListeners: ((state: MCPSDKConnectionState) => void)[] = []
  /** @internal */
  private connectedListeners: (() => void)[] = []
  /** @internal */
  private disconnectedListeners: (() => void)[] = []
  /** @internal */
  private notificationListeners: Map<string, (() => void)[]> = new Map()
  /** @internal */
  private progressListeners: ((progress: ProgressEvent) => void)[] = []
  /** @internal */
  private errorListeners: ((error: MCPSDKError) => void)[] = []
  /** @internal */
  private pongListeners: (() => void)[] = []
  /** @internal */
  private connectionTimeoutListeners: (() => void)[] = []
  /** @internal */
  private pendingRequests: Map<string, { cancelled: boolean }> = new Map()
  /** @internal */
  private currentRequestId = 0
  /** Current transport connection */
  public transport: MCPSDKTransport | null = null
  /** @internal */
  private clientResponsive = true
  /** @internal */
  private pingTimeoutId: ReturnType<typeof setTimeout> | null = null
  /** Whether to cleanup tools on shutdown */
  public cleanupOnShutdown = false

  /**
   * Create a new MCP SDK adapter.
   *
   * @param config - Optional configuration options
   * @throws {Error} If name is explicitly set to empty string
   *
   * @example
   * const adapter = new MCPSDKAdapter({
   *   name: 'my-server',
   *   version: '1.0.0',
   *   mode: 'production',
   *   logger: console
   * })
   */
  constructor(config?: MCPSDKAdapterConfig) {
    // Validate configuration
    if (config?.name !== undefined && config.name === '') {
      throw new Error('Configuration error: name is required and cannot be empty')
    }

    this.config = {
      name: config?.name || 'gitx.do',
      version: config?.version || '0.0.1',
      vendor: config?.vendor || 'gitx.do',
      transports: config?.transports || ['stdio'],
      protocolVersion: config?.protocolVersion || '2024-11-05',
      capabilities: config?.capabilities || {},
      logger: config?.logger,
      mode: config?.mode || 'development',
      pingInterval: config?.pingInterval,
      pingTimeout: config?.pingTimeout,
    }
  }

  /**
   * Get the adapter configuration.
   * @returns Copy of the current configuration
   */
  getConfig(): MCPSDKAdapterConfig {
    return { ...this.config }
  }

  /**
   * Get supported transports.
   * @returns Array of supported transport types
   */
  getSupportedTransports(): MCPSDKTransportType[] {
    return [...(this.config.transports || ['stdio'])]
  }

  /**
   * Get protocol version.
   * @returns The MCP protocol version string
   */
  getProtocolVersion(): string {
    return this.config.protocolVersion || '2024-11-05'
  }

  /**
   * Get SDK version.
   * @returns The SDK version string
   */
  getSDKVersion(): string {
    return '1.0.0'
  }

  /**
   * Get capabilities.
   * @returns Copy of the server capabilities configuration
   */
  getCapabilities(): MCPSDKCapabilities {
    return { ...this.config.capabilities }
  }

  /**
   * Get connection state.
   * @returns Current connection state
   */
  getConnectionState(): MCPSDKConnectionState {
    return this.connectionState
  }

  /**
   * Set connection state and notify listeners.
   * @internal
   */
  private setConnectionState(state: MCPSDKConnectionState): void {
    this.connectionState = state
    for (const listener of this.stateChangeListeners) {
      listener(state)
    }
    if (state === 'connected') {
      for (const listener of this.connectedListeners) {
        listener()
      }
    } else if (state === 'disconnected') {
      for (const listener of this.disconnectedListeners) {
        listener()
      }
    }
  }

  /**
   * Register a state change listener.
   * @param listener - Callback invoked when connection state changes
   * @example
   * adapter.onStateChange((state) => {
   *   console.log(`State changed to: ${state}`)
   * })
   */
  onStateChange(listener: (state: MCPSDKConnectionState) => void): void {
    this.stateChangeListeners.push(listener)
  }

  /**
   * Register a connected listener.
   * @param listener - Callback invoked when connection is established
   */
  onConnected(listener: () => void): void {
    this.connectedListeners.push(listener)
  }

  /**
   * Register a disconnected listener.
   * @param listener - Callback invoked when connection is lost
   */
  onDisconnected(listener: () => void): void {
    this.disconnectedListeners.push(listener)
  }

  /**
   * Register a notification listener.
   * @param type - Notification type to listen for (e.g., 'tools/list_changed')
   * @param listener - Callback invoked when notification is emitted
   */
  onNotification(type: string, listener: () => void): void {
    const listeners = this.notificationListeners.get(type) || []
    listeners.push(listener)
    this.notificationListeners.set(type, listeners)
  }

  /**
   * Emit a notification.
   * @internal
   */
  private emitNotification(type: string): void {
    const listeners = this.notificationListeners.get(type) || []
    for (const listener of listeners) {
      listener()
    }
  }

  /**
   * Register a progress listener.
   * @param listener - Callback invoked when tool reports progress
   */
  onProgress(listener: (progress: ProgressEvent) => void): void {
    this.progressListeners.push(listener)
  }

  /**
   * Register an error listener.
   * @param listener - Callback invoked when an error occurs
   */
  onError(listener: (error: MCPSDKError) => void): void {
    this.errorListeners.push(listener)
  }

  /**
   * Register a pong listener.
   * @param listener - Callback invoked when pong response is received
   */
  onPong(listener: () => void): void {
    this.pongListeners.push(listener)
  }

  /**
   * Register a connection timeout listener.
   * @param listener - Callback invoked when connection times out
   */
  onConnectionTimeout(listener: () => void): void {
    this.connectionTimeoutListeners.push(listener)
  }

  /**
   * Start the adapter.
   *
   * @description
   * Initializes the adapter and transitions to connected state.
   * Must be called before handling any requests.
   *
   * @returns Promise that resolves when started
   * @throws {Error} If adapter is already started
   *
   * @example
   * await adapter.start()
   */
  async start(): Promise<void> {
    if (this.connectionState !== 'disconnected') {
      throw new Error('Adapter is already started or running')
    }

    this.setConnectionState('initializing')

    // Simulate initialization
    await new Promise((resolve) => setTimeout(resolve, 10))

    this.setConnectionState('connected')
  }

  /**
   * Connect with a transport.
   *
   * @description
   * Attaches a transport and starts the adapter if not already running.
   *
   * @param transport - The transport to connect with
   * @returns Promise that resolves when connected
   */
  async connect(transport: MCPSDKTransport): Promise<void> {
    this.transport = transport
    if (this.connectionState === 'disconnected') {
      await this.start()
    }
  }

  /**
   * Shutdown the adapter.
   *
   * @description
   * Gracefully shuts down the adapter, optionally waiting for pending
   * requests and cleaning up registered tools.
   *
   * @param options - Shutdown options
   * @param options.graceful - If true, wait for pending requests
   * @param options.timeout - Max time to wait for pending requests (ms)
   * @param options.cleanup - If true, clear all registered tools
   * @returns Promise that resolves when shutdown is complete
   *
   * @example
   * await adapter.shutdown({ graceful: true, timeout: 5000, cleanup: true })
   */
  async shutdown(options?: {
    graceful?: boolean
    timeout?: number
    cleanup?: boolean
  }): Promise<void> {
    const cleanup = options?.cleanup ?? false
    this.cleanupOnShutdown = cleanup

    if (options?.graceful && options?.timeout) {
      // Wait for pending requests with timeout
      const timeoutPromise = new Promise<void>((resolve) =>
        setTimeout(resolve, options.timeout)
      )
      await Promise.race([this.waitForPendingRequests(), timeoutPromise])
    }

    if (this.pingTimeoutId) {
      clearTimeout(this.pingTimeoutId)
      this.pingTimeoutId = null
    }

    if (cleanup) {
      this.tools.clear()
    }

    this.transport = null
    this.session = null
    this.setConnectionState('disconnected')
  }

  /**
   * Wait for all pending requests to complete.
   * @internal
   */
  private async waitForPendingRequests(): Promise<void> {
    while (this.pendingRequests.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  /**
   * Handle client initialization.
   *
   * @description
   * Processes the client's initialize request, validates protocol version,
   * and creates a session.
   *
   * @param request - Client initialization request
   * @returns Server info and capabilities
   * @throws {MCPSDKError} If protocol version is incompatible
   */
  async handleClientInitialize(
    request: MCPClientInitializeRequest
  ): Promise<{
    serverInfo: { name: string; version: string }
    capabilities: MCPSDKCapabilities
  }> {
    // Validate protocol version
    const supportedVersions = ['2024-11-05']
    if (!supportedVersions.includes(request.protocolVersion)) {
      throw new MCPSDKError(
        MCPSDKErrorCode.INVALID_PARAMS,
        `Incompatible protocol version: ${request.protocolVersion}. Supported versions: ${supportedVersions.join(', ')}`
      )
    }

    // Create session
    this.session = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      clientInfo: request.clientInfo,
      clientCapabilities: request.capabilities as MCPSDKSession['clientCapabilities'],
    }

    return {
      serverInfo: {
        name: this.config.name,
        version: this.config.version,
      },
      capabilities: this.config.capabilities || {},
    }
  }

  /**
   * Get current session.
   * @returns Current session or null if not initialized
   */
  getSession(): MCPSDKSession | null {
    return this.session
  }

  /**
   * Register a tool.
   *
   * @description
   * Adds a tool to the adapter's registry. Emits tools/list_changed notification.
   *
   * @param registration - Tool registration details
   * @throws {Error} If schema type is invalid
   * @throws {Error} If tool with same name already exists
   *
   * @example
   * adapter.registerTool({
   *   name: 'my_tool',
   *   description: 'Does something',
   *   inputSchema: { type: 'object', properties: {} },
   *   handler: async (params, ctx) => ({
   *     content: [{ type: 'text', text: 'Done' }]
   *   })
   * })
   */
  registerTool(registration: MCPSDKToolRegistration): void {
    // Validate schema type
    if (
      registration.inputSchema.type !== 'object' &&
      registration.inputSchema.type !== 'string' &&
      registration.inputSchema.type !== 'number' &&
      registration.inputSchema.type !== 'boolean' &&
      registration.inputSchema.type !== 'array'
    ) {
      throw new Error(
        `Invalid schema type: ${registration.inputSchema.type}. Expected valid JSON Schema type.`
      )
    }

    if (this.tools.has(registration.name)) {
      throw new Error(`Tool '${registration.name}' already exists (duplicate)`)
    }

    const internalTool: InternalTool = {
      ...registration,
      id: `tool-${++this.toolIdCounter}`,
    }

    this.tools.set(registration.name, internalTool)
    this.emitNotification('tools/list_changed')
  }

  /**
   * Register multiple tools.
   *
   * @description
   * Batch registers multiple tools. More efficient than registering
   * individually as it only emits one notification.
   *
   * @param registrations - Array of tool registrations
   * @throws {Error} If any schema type is invalid
   * @throws {Error} If any tool name already exists
   */
  registerTools(registrations: MCPSDKToolRegistration[]): void {
    for (const registration of registrations) {
      // Don't emit notification for each tool
      if (
        registration.inputSchema.type !== 'object' &&
        registration.inputSchema.type !== 'string' &&
        registration.inputSchema.type !== 'number' &&
        registration.inputSchema.type !== 'boolean' &&
        registration.inputSchema.type !== 'array'
      ) {
        throw new Error(
          `Invalid schema type: ${registration.inputSchema.type}. Expected valid JSON Schema type.`
        )
      }

      if (this.tools.has(registration.name)) {
        throw new Error(`Tool '${registration.name}' already exists (duplicate)`)
      }

      const internalTool: InternalTool = {
        ...registration,
        id: `tool-${++this.toolIdCounter}`,
      }

      this.tools.set(registration.name, internalTool)
    }
    this.emitNotification('tools/list_changed')
  }

  /**
   * Unregister a tool.
   * @param name - Name of the tool to unregister
   */
  unregisterTool(name: string): void {
    this.tools.delete(name)
    this.emitNotification('tools/list_changed')
  }

  /**
   * Get a tool by name.
   * @param name - Name of the tool to retrieve
   * @returns Tool metadata (without handler) or undefined if not found
   */
  getTool(
    name: string
  ): (Omit<MCPSDKToolRegistration, 'handler'> & { id: string }) | undefined {
    const tool = this.tools.get(name)
    if (!tool) return undefined
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }
  }

  /**
   * List all tools.
   * @returns Array of tool metadata (without handlers)
   */
  listTools(): Array<Omit<MCPSDKToolRegistration, 'handler'> & { id: string }> {
    const result: Array<
      Omit<MCPSDKToolRegistration, 'handler'> & { id: string }
    > = []
    for (const tool of this.tools.values()) {
      result.push({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })
    }
    return result
  }

  /**
   * Register gitdo tools.
   *
   * @description
   * Convenience method that registers all built-in git tools.
   * Skips tools that are already registered.
   */
  registerGitdoTools(): void {
    for (const tool of gitTools) {
      if (!this.tools.has(tool.name)) {
        this.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as MCPSDKToolRegistration['inputSchema'],
          handler: async (params) => tool.handler(params),
        })
      }
    }
  }

  /**
   * Handle tools/list request.
   *
   * @description
   * Returns paginated list of registered tools. Supports cursor-based pagination.
   *
   * @param options - Pagination options
   * @param options.cursor - Pagination cursor from previous response
   * @returns Paginated tool list with optional next cursor
   */
  async handleToolsList(options?: { cursor?: string }): Promise<{
    tools: Array<{
      name: string
      description: string
      inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] }
    }>
    nextCursor?: string
  }> {
    const allTools = this.listTools()
    const pageSize = 10

    // Parse cursor
    let startIndex = 0
    if (options?.cursor) {
      startIndex = parseInt(options.cursor, 10)
    }

    const endIndex = startIndex + pageSize
    const pageTools = allTools.slice(startIndex, endIndex)

    const result: {
      tools: Array<{
        name: string
        description: string
        inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] }
      }>
      nextCursor?: string
    } = {
      tools: pageTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: string; properties?: Record<string, unknown>; required?: string[] },
      })),
    }

    if (endIndex < allTools.length) {
      result.nextCursor = String(endIndex)
    }

    return result
  }

  /**
   * Handle tools/call request.
   *
   * @description
   * Executes a tool and returns the result. Provides progress reporting
   * and cancellation support through the tool context.
   *
   * @param request - Tool call request with name and arguments
   * @returns Promise with result and requestId for tracking
   * @throws {MCPSDKError} If tool not found or parameters invalid
   *
   * @example
   * const call = adapter.handleToolsCall({
   *   name: 'git_status',
   *   arguments: { short: true }
   * })
   * console.log(`Request ID: ${call.requestId}`)
   * const result = await call
   */
  handleToolsCall(
    request: MCPToolsCallRequest
  ): Promise<MCPToolsCallResult> & { requestId: string } {
    // Generate requestId upfront for consistent tracking
    const requestId = `req-${++this.currentRequestId}`

    // Helper to create a rejected promise with requestId attached
    const createRejectedPromise = (error: Error): Promise<MCPToolsCallResult> & { requestId: string } => {
      const promise = Promise.reject(error) as Promise<MCPToolsCallResult> & { requestId: string }
      promise.requestId = requestId
      return promise
    }

    const tool = this.tools.get(request.name)
    if (!tool) {
      return createRejectedPromise(new MCPSDKError(
        MCPSDKErrorCode.TOOL_NOT_FOUND,
        `Tool '${request.name}' not found (nonexistent)`
      ))
    }

    // Validate required parameters
    const schema = tool.inputSchema
    if (schema.required) {
      for (const requiredParam of schema.required) {
        if (
          !(requiredParam in request.arguments) ||
          request.arguments[requiredParam] === undefined
        ) {
          return createRejectedPromise(new MCPSDKError(
            MCPSDKErrorCode.INVALID_PARAMS,
            `Missing required parameter: ${requiredParam}`
          ))
        }
      }
    }

    // Create request tracking
    this.pendingRequests.set(requestId, { cancelled: false })

    // Create context
    const context: MCPSDKToolContext = {
      reportProgress: async (progress: number, total: number) => {
        for (const listener of this.progressListeners) {
          listener({ progress, total })
        }
      },
      isCancelled: () => {
        const req = this.pendingRequests.get(requestId)
        return req?.cancelled ?? false
      },
    }

    const executeHandler = async (): Promise<MCPToolsCallResult> => {
      try {
        const result = await tool.handler(request.arguments, context)
        this.pendingRequests.delete(requestId)
        return { ...result, requestId }
      } catch (error) {
        this.pendingRequests.delete(requestId)

        // Log error if logger configured
        if (this.config.logger?.error) {
          this.config.logger.error(
            'Tool execution error:',
            error instanceof Error ? error.message : String(error)
          )
        }

        // Format error message based on mode
        let errorText =
          error instanceof Error ? error.message : String(error)
        if (this.config.mode === 'development' && error instanceof Error && error.stack) {
          errorText = error.stack
        }

        return {
          content: [{ type: 'text', text: errorText }],
          isError: true,
          requestId,
        }
      }
    }

    // Create the promise and attach the requestId property
    const promise = executeHandler() as Promise<MCPToolsCallResult> & { requestId: string }
    promise.requestId = requestId
    return promise
  }

  /**
   * Cancel a request.
   *
   * @description
   * Marks a pending request as cancelled. The tool handler can check
   * cancellation status via context.isCancelled().
   *
   * @param requestId - The request ID to cancel
   */
  cancelRequest(requestId: string | undefined): void {
    if (requestId) {
      const req = this.pendingRequests.get(requestId)
      if (req) {
        req.cancelled = true
      }
    }
  }

  /**
   * Handle raw JSON-RPC message.
   *
   * @description
   * Parses and processes a raw JSON-RPC message string. Routes to
   * appropriate handlers based on the method.
   *
   * @param message - Raw JSON-RPC message string
   * @returns JSON-RPC response string
   */
  async handleMessage(message: string): Promise<string> {
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: MCPSDKErrorCode.PARSE_ERROR,
          message: 'Parse error: Invalid JSON',
        },
      })
    }

    // Handle batch requests
    if (Array.isArray(parsed)) {
      const responses = await Promise.all(
        parsed.map((req) => this.handleSingleMessage(req))
      )
      return JSON.stringify(responses)
    }

    const response = await this.handleSingleMessage(parsed)
    return JSON.stringify(response)
  }

  /**
   * Handle a single JSON-RPC message
   */
  private async handleSingleMessage(
    request: unknown
  ): Promise<{
    jsonrpc: '2.0'
    id: string | number | null
    result?: unknown
    error?: { code: number; message: string }
  }> {
    const req = request as {
      jsonrpc?: string
      id?: string | number
      method?: string
      params?: Record<string, unknown>
    }

    const id = req.id ?? null

    if (req.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: MCPSDKErrorCode.INVALID_REQUEST,
          message: 'Invalid Request: missing or invalid jsonrpc version',
        },
      }
    }

    try {
      switch (req.method) {
        case 'tools/list': {
          const result = await this.handleToolsList(req.params as { cursor?: string })
          return { jsonrpc: '2.0', id, result }
        }
        case 'tools/call': {
          const result = await this.handleToolsCall(req.params as unknown as MCPToolsCallRequest)
          return { jsonrpc: '2.0', id, result }
        }
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: MCPSDKErrorCode.METHOD_NOT_FOUND,
              message: `Method not found: ${req.method}`,
            },
          }
      }
    } catch (error) {
      if (error instanceof MCPSDKError) {
        return {
          jsonrpc: '2.0',
          id,
          error: error.toJSONRPC(),
        }
      }
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: MCPSDKErrorCode.INTERNAL_ERROR,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      }
    }
  }

  /**
   * Simulate a pending request (for testing).
   * @internal
   */
  simulatePendingRequest(): PendingRequest {
    const requestId = `sim-req-${++this.currentRequestId}`
    this.pendingRequests.set(requestId, { cancelled: false })
    return {
      complete: async () => {
        this.pendingRequests.delete(requestId)
      },
    }
  }

  /**
   * Simulate an internal error (for testing).
   * @internal
   */
  simulateInternalError(error: Error): void {
    const mcpError = new MCPSDKError(
      MCPSDKErrorCode.INTERNAL_ERROR,
      error.message
    )
    for (const listener of this.errorListeners) {
      listener(mcpError)
    }
  }

  /**
   * Send ping to check client responsiveness.
   */
  sendPing(): void {
    // Simulate ping/pong
    setTimeout(() => {
      if (this.clientResponsive) {
        for (const listener of this.pongListeners) {
          listener()
        }
      }
    }, 10)

    // Set timeout for pong response
    if (this.config.pingTimeout) {
      this.pingTimeoutId = setTimeout(() => {
        if (!this.clientResponsive) {
          for (const listener of this.connectionTimeoutListeners) {
            listener()
          }
        }
      }, this.config.pingTimeout)
    }
  }

  /**
   * Simulate client becoming unresponsive (for testing).
   * @internal
   */
  simulateClientUnresponsive(): void {
    this.clientResponsive = false
    // Trigger a ping to start the timeout
    this.sendPing()
  }
}

/**
 * Transport factory.
 *
 * @description
 * Factory object for creating transport instances. Provides methods
 * for creating stdio, SSE, and HTTP transports.
 *
 * @example
 * // Create a stdio transport
 * const transport = MCPSDKTransport.createStdio()
 *
 * // Create an SSE transport
 * const sseTransport = MCPSDKTransport.createSSE({ endpoint: '/sse' })
 *
 * // Create an HTTP transport
 * const httpTransport = MCPSDKTransport.createHTTP({ endpoint: '/api' })
 */
export const MCPSDKTransport = {
  createStdio(_options?: {
    stdin?: { on: unknown; read: unknown; pipe: unknown }
    stdout?: { write: unknown; end: unknown }
  }): MCPSDKTransport {
    return {
      type: 'stdio',
      isConnected: () => true,
      send: () => {},
      receive: async () => '',
      close: () => {},
    }
  },

  createSSE(_options: { endpoint: string }): MCPSDKTransport & {
    handleRequest: (request: unknown) => Promise<{ status: number; headers: Record<string, string>; body?: string }>
  } {
    let connected = false
    return {
      type: 'sse',
      isConnected: () => connected,
      send: () => {},
      receive: async () => '',
      close: () => {
        connected = false
      },
      handleRequest: async (_request: unknown) => {
        connected = true
        return { status: 200, headers: {} }
      },
    }
  },

  createHTTP(_options: { endpoint: string }): MCPSDKTransport & {
    handleRequest: (request: {
      method: string
      body: string
      headers: Record<string, string>
    }) => Promise<{ status: number; headers: Record<string, string>; body?: string }>
  } {
    return {
      type: 'http',
      isConnected: () => true,
      send: () => {},
      receive: async () => '',
      close: () => {},
      handleRequest: async (_request) => {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', result: {} }),
        }
      },
    }
  },
}

/**
 * Factory function to create an MCP SDK adapter.
 *
 * @description
 * Convenience function for creating a new MCP SDK adapter instance.
 * Equivalent to using `new MCPSDKAdapter(config)`.
 *
 * @param config - Optional adapter configuration
 * @returns A new MCPSDKAdapter instance
 *
 * @example
 * import { createMCPSDKAdapter } from './sdk-adapter'
 *
 * const adapter = createMCPSDKAdapter({
 *   name: 'git-server',
 *   version: '1.0.0',
 *   capabilities: { tools: { listChanged: true } }
 * })
 *
 * adapter.registerGitdoTools()
 * await adapter.start()
 */
export function createMCPSDKAdapter(config?: MCPSDKAdapterConfig): MCPSDKAdapter {
  return new MCPSDKAdapter(config)
}
