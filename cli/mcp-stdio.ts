/**
 * MCP stdio Transport Module
 *
 * Implements MCP (Model Context Protocol) communication over stdin/stdout
 * using JSON-RPC 2.0 with newline-delimited message framing.
 *
 * @see https://modelcontextprotocol.io/docs/concepts/transports
 * @see https://www.jsonrpc.org/specification
 */

import { EventEmitter } from 'events'

// ============================================================================
// Type Exports
// ============================================================================

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse extends JsonRpcMessage {
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcNotification extends JsonRpcMessage {
  method: string
  params?: Record<string, unknown>
}

export interface TransportOptions {
  stdin: NodeJS.ReadableStream | { on: Function; pipe: Function; destroy: Function }
  stdout: NodeJS.WritableStream | { write: Function; end: Function; destroy: Function }
  stderr?: NodeJS.WritableStream | { write: Function; end: Function; destroy: Function }
  delimiter?: string
  encoding?: BufferEncoding
  maxMessageSize?: number
}

export interface MessageHandler {
  (message: JsonRpcMessage, send: (response: JsonRpcMessage) => Promise<void>): Promise<void> | void
}

export interface StdioSession {
  id: string
  createdAt: number
  lastActivity: number
  state: 'created' | 'initialized' | 'running' | 'closed'
  clientInfo?: { name: string; version: string }
  transport?: McpStdioTransport
  inactivityTimeout?: number

  initialize(params: {
    protocolVersion: string
    clientInfo: { name: string; version: string }
    capabilities: Record<string, unknown>
  }): void
  start(): void
  close(): void
  touch(): void
  attachTransport(transport: McpStdioTransport): void
  respond(id: string | number, result: unknown): Promise<void>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  registerTool(tool: McpTool): void
  unregisterTool(name: string): void
  getTools(): McpTool[]
  on(event: string, callback: (...args: unknown[]) => void): void
  startTimeoutTimer(): void
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MessageFramer {
  push(data: string): void
  getMessages(): string[]
  reset(): void
  bufferSize(): number
}

export interface MessageFramerOptions {
  delimiter?: string
  maxBufferSize?: number
}

// ============================================================================
// MCP Bridge Types (for HTTP proxy)
// ============================================================================

export interface McpBridgeOptions {
  targetUrl?: string
  fetch?: typeof fetch
  retries?: number
}

export interface McpBridge {
  targetUrl: string
  proxy(message: JsonRpcMessage): Promise<JsonRpcResponse>
}

export interface McpServerOptions {
  stdin: NodeJS.ReadableStream | { on: Function; pipe: Function; destroy: Function }
  stdout: NodeJS.WritableStream | { write: Function; end: Function; destroy: Function }
  fetch?: typeof fetch
  targetUrl?: string
}

export interface McpServer {
  isRunning(): boolean
  stop(): Promise<void>
}

// ============================================================================
// JSON-RPC Message Parsing
// ============================================================================

/**
 * Parse a JSON-RPC message from string
 */
export function parseJsonRpcMessage(input: string): JsonRpcMessage {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('Failed to parse JSON')
  }

  // Validate jsonrpc version
  if (parsed.jsonrpc !== '2.0') {
    throw new Error('Invalid or missing jsonrpc version')
  }

  // Validate id type if present
  if (parsed.id !== undefined && parsed.id !== null) {
    if (typeof parsed.id !== 'string' && typeof parsed.id !== 'number') {
      throw new Error('Invalid id type: must be string, number, or null')
    }
    if (typeof parsed.id === 'object') {
      throw new Error('Invalid id type: must be string, number, or null')
    }
  }

  // Validate params if present (MCP requires object, not array)
  if (parsed.params !== undefined) {
    if (Array.isArray(parsed.params)) {
      throw new Error('MCP requires params to be an object, not an array')
    }
  }

  return parsed as JsonRpcMessage
}

/**
 * Serialize a JSON-RPC message to string
 */
export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message)
}

// ============================================================================
// Message Framing
// ============================================================================

/**
 * Create a message framer for handling newline-delimited JSON
 */
export function createMessageFramer(options?: MessageFramerOptions): MessageFramer {
  const delimiter = options?.delimiter ?? '\n'
  const maxBufferSize = options?.maxBufferSize ?? Infinity
  let buffer = ''

  return {
    push(data: string): void {
      if (buffer.length + data.length > maxBufferSize) {
        throw new Error('Buffer size limit exceeded')
      }
      buffer += data
    },

    getMessages(): string[] {
      const messages: string[] = []
      let delimiterIndex: number

      while ((delimiterIndex = buffer.indexOf(delimiter)) !== -1) {
        const message = buffer.slice(0, delimiterIndex)
        buffer = buffer.slice(delimiterIndex + delimiter.length)
        if (message.length > 0) {
          messages.push(message)
        }
      }

      return messages
    },

    reset(): void {
      buffer = ''
    },

    bufferSize(): number {
      return buffer.length
    },
  }
}

// ============================================================================
// McpStdioTransport Class
// ============================================================================

export class McpStdioTransport extends EventEmitter {
  private options: TransportOptions
  private connected: boolean = false
  private messageHandler?: MessageHandler
  private framer: MessageFramer
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: TransportOptions) {
    super()
    this.options = options
    this.framer = createMessageFramer({
      delimiter: options.delimiter ?? '\n',
      maxBufferSize: options.maxMessageSize,
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  async start(): Promise<void> {
    if (this.connected) {
      throw new Error('Transport is already connected')
    }

    this.connected = true
    this.emit('connected')

    // Listen for data from stdin
    this.options.stdin.on('data', (data: Buffer | string) => {
      this.handleIncomingData(data)
    })

    // Handle stdin close
    this.options.stdin.on('close', () => {
      this.handleDisconnect()
    })

    // Handle stdin error
    this.options.stdin.on('error', (error: Error) => {
      this.emit('error', error)
    })
  }

  private handleIncomingData(data: Buffer | string): void {
    const str = typeof data === 'string' ? data : data.toString(this.options.encoding ?? 'utf-8')

    try {
      this.framer.push(str)
    } catch {
      this.emit('error', new Error('Message size limit exceeded'))
      return
    }

    const messages = this.framer.getMessages()
    for (const raw of messages) {
      this.processMessage(raw)
    }
  }

  private processMessage(raw: string): void {
    // Handle empty messages gracefully
    if (!raw.trim()) {
      return
    }

    let message: JsonRpcMessage
    try {
      message = parseJsonRpcMessage(raw)
    } catch (error) {
      const parseError = error as Error
      this.emit('error', new Error(`JSON parse error: ${parseError.message}`))
      // Send parse error response
      this.sendErrorResponse(null, -32700, 'Parse error')
      return
    }

    // Validate that it's a request (has method) or response (has result/error)
    const isRequest = 'method' in message
    const isResponse = 'result' in message || 'error' in message

    if (!isRequest && !isResponse && message.id !== undefined) {
      // Has id but no method and no result/error - invalid request
      this.emit('error', new Error('Invalid request: missing method'))
      this.sendErrorResponse(message.id as string | number | null, -32600, 'Invalid Request')
      return
    }

    // Emit message event
    this.emit('message', message)

    // Call message handler if registered
    if (this.messageHandler) {
      const sendFn = (response: JsonRpcMessage) => this.send(response)
      Promise.resolve(this.messageHandler(message, sendFn)).catch((err) => {
        this.emit('error', err)
      })
    }
  }

  private async sendErrorResponse(id: string | number | null, code: number, message: string): Promise<void> {
    try {
      await this.send({
        jsonrpc: '2.0',
        id,
        error: { code, message },
      })
    } catch {
      // Ignore errors when sending error response
    }
  }

  private handleDisconnect(): void {
    if (this.connected) {
      this.connected = false
      this.emit('disconnected')
    }
  }

  async close(): Promise<void> {
    if (this.connected) {
      this.connected = false
      this.emit('disconnected')
    }
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport is closed')
    }

    const serialized = serializeJsonRpcMessage(message) + (this.options.delimiter ?? '\n')

    // Queue writes to preserve order
    this.writeQueue = this.writeQueue.then(() => {
      return new Promise<void>((resolve) => {
        try {
          const stdout = this.options.stdout as { write: Function }
          stdout.write(serialized, () => {
            resolve()
          })
        } catch (error) {
          this.emit('error', error)
          resolve()
        }
      })
    })

    await this.writeQueue
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new MCP stdio transport
 */
export function createStdioTransport(options: TransportOptions): McpStdioTransport {
  return new McpStdioTransport(options)
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new MCP stdio session
 */
export function createStdioSession(options?: { inactivityTimeout?: number }): StdioSession {
  const emitter = new EventEmitter()
  let state: 'created' | 'initialized' | 'running' | 'closed' = 'created'
  let clientInfo: { name: string; version: string } | undefined
  let transport: McpStdioTransport | undefined
  let lastActivity = Date.now()
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const tools: Map<string, McpTool> = new Map()

  const session: StdioSession = {
    id: generateSessionId(),
    createdAt: Date.now(),
    get lastActivity() {
      return lastActivity
    },
    get state() {
      return state
    },
    get clientInfo() {
      return clientInfo
    },
    get transport() {
      return transport
    },
    get inactivityTimeout() {
      return options?.inactivityTimeout
    },

    initialize(params: {
      protocolVersion: string
      clientInfo: { name: string; version: string }
      capabilities: Record<string, unknown>
    }): void {
      if (state === 'closed') {
        throw new Error('Cannot initialize closed session')
      }
      clientInfo = params.clientInfo
      state = 'initialized'
      this.touch()
    },

    start(): void {
      if (state === 'initialized') {
        state = 'running'
        this.touch()
      }
    },

    close(): void {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
      }
      state = 'closed'
      if (transport) {
        transport.close()
      }
    },

    touch(): void {
      lastActivity = Date.now()
      if (timeoutTimer && options?.inactivityTimeout) {
        clearTimeout(timeoutTimer)
        timeoutTimer = setTimeout(() => {
          emitter.emit('timeout')
        }, options.inactivityTimeout)
      }
    },

    attachTransport(t: McpStdioTransport): void {
      transport = t

      // Listen for initialize messages
      transport.on('message', (msg: JsonRpcMessage) => {
        if (msg.method === 'initialize' && msg.params) {
          this.initialize(msg.params as {
            protocolVersion: string
            clientInfo: { name: string; version: string }
            capabilities: Record<string, unknown>
          })
        }
        this.touch()
      })
    },

    async respond(id: string | number, result: unknown): Promise<void> {
      if (transport) {
        await transport.send({
          jsonrpc: '2.0',
          id,
          result,
        })
      }
    },

    async notify(method: string, params?: Record<string, unknown>): Promise<void> {
      if (transport) {
        await transport.send({
          jsonrpc: '2.0',
          method,
          params,
        })
      }
    },

    registerTool(tool: McpTool): void {
      tools.set(tool.name, tool)
      // Send notification if initialized
      if (state === 'initialized' || state === 'running') {
        this.notify('notifications/tools/list_changed', {})
      }
    },

    unregisterTool(name: string): void {
      tools.delete(name)
      // Send notification if initialized
      if (state === 'initialized' || state === 'running') {
        this.notify('notifications/tools/list_changed', {})
      }
    },

    getTools(): McpTool[] {
      return Array.from(tools.values())
    },

    on(event: string, callback: (...args: unknown[]) => void): void {
      emitter.on(event, callback)
    },

    startTimeoutTimer(): void {
      if (options?.inactivityTimeout) {
        timeoutTimer = setTimeout(() => {
          emitter.emit('timeout')
        }, options.inactivityTimeout)
      }
    },
  }

  return session
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ============================================================================
// MCP HTTP Bridge Functions (Stubs - not tested yet)
// ============================================================================

/**
 * Create a new MCP HTTP bridge that proxies stdio to DO's /mcp endpoint
 */
export function createMcpBridge(options?: McpBridgeOptions): McpBridge {
  const targetUrl = options?.targetUrl ?? process.env.DO_URL ?? 'http://localhost:8787'
  const fetchFn = options?.fetch ?? fetch

  return {
    targetUrl,
    async proxy(message: JsonRpcMessage): Promise<JsonRpcResponse> {
      const res = await fetchFn(`${targetUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })
      return (await res.json()) as JsonRpcResponse
    },
  }
}

/**
 * Start MCP stdio server that proxies to DO
 */
export async function startMcpServer(options: McpServerOptions): Promise<McpServer> {
  const transport = createStdioTransport({
    stdin: options.stdin,
    stdout: options.stdout,
  })

  const bridge = createMcpBridge({
    targetUrl: options.targetUrl,
    fetch: options.fetch,
  })

  let running = true

  transport.setMessageHandler(async (message, send) => {
    const response = await bridge.proxy(message)
    await send(response)
  })

  await transport.start()

  return {
    isRunning(): boolean {
      return running
    },
    async stop(): Promise<void> {
      running = false
      await transport.close()
    },
  }
}

/**
 * MCP command handler for CLI
 */
export async function mcpCommand(args?: { url?: string }): Promise<void> {
  const server = await startMcpServer({
    stdin: process.stdin,
    stdout: process.stdout,
    targetUrl: args?.url ?? process.env.DO_URL,
  })

  // Handle process signals
  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await server.stop()
    process.exit(0)
  })
}
