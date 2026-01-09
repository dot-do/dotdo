/**
 * MCP stdio Transport Module (Stub)
 *
 * This is a stub file to verify tests are syntactically correct.
 * Full implementation will be done in the GREEN phase.
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
// McpStdioTransport Class (Stub)
// ============================================================================

export class McpStdioTransport extends EventEmitter {
  private options: TransportOptions
  private connected: boolean = false
  private messageHandler?: MessageHandler

  constructor(options: TransportOptions) {
    super()
    this.options = options
  }

  isConnected(): boolean {
    throw new Error('Not implemented: isConnected')
  }

  async start(): Promise<void> {
    throw new Error('Not implemented: start')
  }

  async close(): Promise<void> {
    throw new Error('Not implemented: close')
  }

  async send(message: JsonRpcMessage): Promise<void> {
    throw new Error('Not implemented: send')
  }

  setMessageHandler(handler: MessageHandler): void {
    throw new Error('Not implemented: setMessageHandler')
  }
}

// ============================================================================
// Factory Functions (Stubs)
// ============================================================================

/**
 * Create a new MCP stdio transport
 * @throws {Error} Not implemented
 */
export function createStdioTransport(options: TransportOptions): McpStdioTransport {
  throw new Error('Not implemented: createStdioTransport')
}

/**
 * Parse a JSON-RPC message from string
 * @throws {Error} Not implemented
 */
export function parseJsonRpcMessage(input: string): JsonRpcMessage {
  throw new Error('Not implemented: parseJsonRpcMessage')
}

/**
 * Serialize a JSON-RPC message to string
 * @throws {Error} Not implemented
 */
export function serializeJsonRpcMessage(message: JsonRpcMessage): string {
  throw new Error('Not implemented: serializeJsonRpcMessage')
}

/**
 * Create a message framer for handling newline-delimited JSON
 * @throws {Error} Not implemented
 */
export function createMessageFramer(options?: MessageFramerOptions): MessageFramer {
  throw new Error('Not implemented: createMessageFramer')
}

/**
 * Create a new MCP stdio session
 * @throws {Error} Not implemented
 */
export function createStdioSession(options?: { inactivityTimeout?: number }): StdioSession {
  throw new Error('Not implemented: createStdioSession')
}
