/**
 * Cap'n Web RPC Client for CLI
 *
 * WebSocket-based RPC client that:
 * 1. Connects to dotdo DOs via WebSocket
 * 2. Introspects schema on connect
 * 3. Generates TypeScript definitions from schema
 * 4. Supports streaming responses
 */

import WebSocket from 'ws'
import { EventEmitter } from 'events'

/**
 * RPC message types matching the server protocol
 */
export interface RpcMessage {
  id: string
  type: 'call' | 'response' | 'callback' | 'subscribe' | 'unsubscribe' | 'event' | 'error' | 'introspect'
  path?: string[]
  args?: unknown[]
  result?: unknown
  error?: { message: string; code?: string }
  callbackId?: string
  eventType?: string
  data?: unknown
}

/**
 * Schema types from introspection
 */
export interface FieldSchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface ParamSchema {
  name: string
  type: string
  required?: boolean
}

export interface MethodSchema {
  name: string
  params: ParamSchema[]
  returns: string
  description?: string
}

export interface Schema {
  name: string
  fields: FieldSchema[]
  methods: MethodSchema[]
}

/**
 * Connection options
 */
export interface RpcClientOptions {
  /** WebSocket URL (e.g., wss://api.dotdo.dev/ws/rpc) */
  url: string
  /** Authentication token */
  token?: string
  /** Connection timeout in ms */
  timeout?: number
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean
  /** Debug logging */
  debug?: boolean
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * CLI RPC Client
 *
 * Provides a WebSocket connection to dotdo DOs with:
 * - Promise-based RPC calls
 * - Event subscriptions
 * - Schema introspection
 */
export class RpcClient extends EventEmitter {
  private ws: WebSocket | null = null
  private messageId = 0
  private pendingCalls = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private callbacks = new Map<string, (...args: unknown[]) => void>()
  private schema: Schema | null = null
  private options: Required<RpcClientOptions>
  private state: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000

  constructor(options: RpcClientOptions) {
    super()
    this.options = {
      url: options.url,
      token: options.token ?? '',
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      debug: options.debug ?? false,
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Get cached schema (null if not connected)
   */
  getSchema(): Schema | null {
    return this.schema
  }

  /**
   * Connect to the RPC endpoint
   */
  async connect(): Promise<Schema> {
    if (this.state === 'connected' && this.ws) {
      return this.schema!
    }

    this.state = 'connecting'
    this.emit('connecting')

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (this.options.token) {
        headers['Authorization'] = `Bearer ${this.options.token}`
      }

      this.ws = new WebSocket(this.options.url, { headers })

      const timeout = setTimeout(() => {
        this.ws?.close()
        this.state = 'error'
        reject(new Error('Connection timeout'))
      }, this.options.timeout)

      this.ws.on('open', async () => {
        clearTimeout(timeout)
        this.state = 'connected'
        this.reconnectAttempts = 0
        this.emit('connected')

        try {
          // Introspect schema on connect
          this.schema = await this.introspect()
          resolve(this.schema)
        } catch (err) {
          reject(err)
        }
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('error', (err) => {
        this.log('WebSocket error:', err)
        this.state = 'error'
        this.emit('error', err)
      })

      this.ws.on('close', (code, reason) => {
        this.log('WebSocket closed:', code, reason.toString())
        this.state = 'disconnected'
        this.emit('disconnected', { code, reason: reason.toString() })
        this.handleDisconnect()
      })
    })
  }

  /**
   * Disconnect from the RPC endpoint
   */
  disconnect(): void {
    this.options.autoReconnect = false
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
    this.cleanup()
    this.state = 'disconnected'
  }

  /**
   * Introspect the remote DO's schema
   */
  private async introspect(): Promise<Schema> {
    const result = await this.call(['$meta', 'schema'], [])
    return result as Schema
  }

  /**
   * Make an RPC call
   */
  async call(path: string[], args: unknown[]): Promise<unknown> {
    if (this.state !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    // Capture ws reference after null check to avoid non-null assertion
    const ws = this.ws

    const id = this.generateId()
    const serializedArgs = this.serializeArgs(args)

    const message: RpcMessage = {
      id,
      type: 'call',
      path,
      args: serializedArgs,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`RPC call timeout: ${path.join('.')}`))
      }, this.options.timeout)

      this.pendingCalls.set(id, { resolve, reject, timeout })

      this.log('Sending:', message)
      ws.send(JSON.stringify(message))
    })
  }

  /**
   * Subscribe to events
   */
  subscribe(eventType: string, handler: (data: unknown) => void): () => void {
    if (!this.ws) {
      throw new Error('Not connected')
    }

    const callbackId = this.generateId()
    this.callbacks.set(callbackId, handler)

    const message: RpcMessage = {
      id: this.generateId(),
      type: 'subscribe',
      eventType,
      callbackId,
    }

    this.ws.send(JSON.stringify(message))

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callbackId)
      if (this.ws && this.state === 'connected') {
        const unsubMsg: RpcMessage = {
          id: this.generateId(),
          type: 'unsubscribe',
          eventType,
        }
        this.ws.send(JSON.stringify(unsubMsg))
      }
    }
  }

  /**
   * Create a proxy for fluent method calls
   */
  createProxy<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(): T {
    return this.createProxyAtPath([]) as T
  }

  private createProxyAtPath(path: string[]): unknown {
    return new Proxy(() => {}, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') return undefined
        if (prop === 'then') return undefined

        const newPath = [...path, prop as string]
        return this.createProxyAtPath(newPath)
      },
      apply: (_target, _thisArg, args) => {
        return this.call(path, args)
      },
    })
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: RpcMessage = JSON.parse(data)
      this.log('Received:', message)

      switch (message.type) {
        case 'response':
          this.handleResponse(message)
          break
        case 'callback':
          this.handleCallback(message)
          break
        case 'event':
          this.handleEvent(message)
          break
        case 'error':
          this.handleError(message)
          break
      }
    } catch (err) {
      this.log('Failed to parse message:', err)
    }
  }

  private handleResponse(message: RpcMessage): void {
    const pending = this.pendingCalls.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingCalls.delete(message.id)

    if (message.error) {
      pending.reject(new Error(message.error.message))
    } else {
      pending.resolve(this.deserializeResult(message.result))
    }
  }

  private handleCallback(message: RpcMessage): void {
    const callback = this.callbacks.get(message.callbackId!)
    if (callback) {
      callback(...(message.args ?? []))
    }
  }

  private handleEvent(message: RpcMessage): void {
    this.emit('event', {
      type: message.eventType,
      data: message.data,
    })
  }

  private handleError(message: RpcMessage): void {
    this.emit('rpcError', message.error)
  }

  /**
   * Handle disconnection with optional reconnect
   */
  private handleDisconnect(): void {
    this.cleanup()

    if (this.options.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
      this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

      setTimeout(() => {
        this.connect().catch((err) => {
          this.log('Reconnect failed:', err)
        })
      }, delay)
    }
  }

  /**
   * Clean up pending calls
   */
  private cleanup(): void {
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
    }
    this.pendingCalls.clear()
  }

  /**
   * Serialize arguments, handling functions as callbacks
   */
  private serializeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => this.serializeValue(arg))
  }

  private serializeValue(value: unknown): unknown {
    if (typeof value === 'function') {
      const callbackId = this.generateId()
      this.callbacks.set(callbackId, value as (...args: unknown[]) => void)
      return { __rpc_callback_id: callbackId }
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v))
    }

    if (value instanceof Date) {
      return { __rpc_date: value.toISOString() }
    }

    if (typeof value === 'object' && value !== null) {
      const serialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        serialized[k] = this.serializeValue(v)
      }
      return serialized
    }

    return value
  }

  /**
   * Deserialize result, restoring dates
   */
  private deserializeResult(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeResult(v))
    }

    if (typeof value === 'object' && value !== null) {
      if ('__rpc_date' in value) {
        return new Date((value as { __rpc_date: string }).__rpc_date)
      }

      const deserialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        deserialized[k] = this.deserializeResult(v)
      }
      return deserialized
    }

    return value
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${++this.messageId}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[RpcClient]', ...args)
    }
  }
}

/**
 * Generate TypeScript definitions from schema
 */
export function generateTypeDefinitions(schema: Schema): string {
  const lines: string[] = []

  lines.push(`// Auto-generated from ${schema.name} schema`)
  lines.push('')

  // Generate interface for the DO
  lines.push(`interface ${schema.name} {`)

  // Add fields
  for (const field of schema.fields) {
    const optional = field.required === false ? '?' : ''
    const doc = field.description ? `  /** ${field.description} */\n` : ''
    lines.push(`${doc}  ${field.name}${optional}: ${mapType(field.type)};`)
  }

  lines.push('')

  // Add methods
  for (const method of schema.methods) {
    const params = method.params
      .map((p) => `${p.name}${p.required === false ? '?' : ''}: ${mapType(p.type)}`)
      .join(', ')
    const returnType = mapType(method.returns)
    const doc = method.description ? `  /** ${method.description} */\n` : ''
    lines.push(`${doc}  ${method.name}(${params}): ${returnType};`)
  }

  lines.push('}')
  lines.push('')

  // Declare the DO as available in REPL
  lines.push(`declare const ${schema.name.toLowerCase()}: ${schema.name};`)

  return lines.join('\n')
}

/**
 * Map schema types to TypeScript types
 */
function mapType(schemaType: string): string {
  // Handle Promise types
  if (schemaType.startsWith('Promise<')) {
    return schemaType
  }

  // Handle array types
  if (schemaType.endsWith('[]')) {
    const baseType = schemaType.slice(0, -2)
    return `${mapType(baseType)}[]`
  }

  // Map common types
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    Date: 'Date',
    unknown: 'unknown',
    void: 'void',
    null: 'null',
    undefined: 'undefined',
    object: 'Record<string, unknown>',
  }

  return typeMap[schemaType] ?? schemaType
}

/**
 * Create a connected RPC client
 */
export async function createRpcClient(options: RpcClientOptions): Promise<RpcClient> {
  const client = new RpcClient(options)
  await client.connect()
  return client
}
