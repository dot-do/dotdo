/**
 * Benthos Input/Output Connectors
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Input sources and output sinks for message processing.
 */

import { BenthosMessage, BenthosBatch, createMessage, isMessage, isBatch, MessageMetadata } from './message'
import { parse } from './bloblang/parser'
import { Interpreter } from './bloblang/interpreter'
import type { ASTNode } from './bloblang/ast'

// Input Types
export interface StartResult {
  success: boolean
  error?: string
  resourcesFreed?: boolean
}

export interface AckResult {
  success: boolean
  error?: string
}

export interface CloseResult {
  success: boolean
  error?: string
  resourcesFreed?: boolean
}

export interface InputMessage {
  content: string
  metadata: MessageMetadata
}

export interface Input {
  start(): Promise<StartResult>
  next(): Promise<InputMessage | null>
  ack(msg: InputMessage): Promise<AckResult>
  close(): Promise<CloseResult>
}

export interface GenerateInputConfig {
  template: string
  count?: number
  interval?: number
  batchSize?: number
  metadata?: Record<string, string>
}

export interface HttpServerInputConfig {
  port: number
  hostname?: string
  path?: string
  methods?: string[]
  contentType?: string
  extractHeaders?: string[]
  headerPrefix?: string
  pathParams?: string[]
  maxBodySize?: number
}

// GenerateInput Implementation
class GenerateInput implements Input {
  private config: GenerateInputConfig
  private started = false
  private closed = false
  private messageCount = 0
  private ast?: ASTNode
  private parseError?: Error
  private intervalTimer?: NodeJS.Timeout
  private messageQueue: InputMessage[] = []

  constructor(config: GenerateInputConfig) {
    this.config = {
      ...config,
      batchSize: config.batchSize ?? 1,
    }
  }

  async start(): Promise<StartResult> {
    if (this.closed) {
      this.closed = false
      this.messageCount = 0
      this.messageQueue = []
    }

    try {
      this.ast = parse(this.config.template)
      this.started = true
      this.parseError = undefined

      if (this.config.interval !== undefined && this.config.interval > 0) {
        this.scheduleNextGeneration()
      }

      return { success: true, resourcesFreed: true }
    } catch (error) {
      this.parseError = error as Error
      return {
        success: false,
        error: (error as Error).message,
      }
    }
  }

  async next(): Promise<InputMessage | null> {
    if (!this.started) {
      throw new Error('Input not started')
    }

    if (this.closed) {
      throw new Error('Input closed')
    }

    if (this.parseError) {
      return null
    }

    const count = this.config.count
    if (count !== undefined && this.messageCount >= count) {
      return null
    }

    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    const batchSize = this.config.batchSize ?? 1
    const interval = this.config.interval

    if (interval !== undefined && interval > 0) {
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (this.closed) {
            clearInterval(checkInterval)
            reject(new Error('Input closed'))
            return
          }

          if (this.messageQueue.length > 0) {
            clearInterval(checkInterval)
            resolve(this.messageQueue.shift()!)
          }
        }, 10)
      })
    }

    const messagesToGenerate = Math.min(
      batchSize,
      count !== undefined ? count - this.messageCount : batchSize
    )

    for (let i = 0; i < messagesToGenerate; i++) {
      if (count !== undefined && this.messageCount >= count) {
        break
      }
      this.messageQueue.push(this.generateMessage())
    }

    return this.messageQueue.shift() ?? null
  }

  async ack(_msg: InputMessage): Promise<AckResult> {
    return { success: true }
  }

  async close(): Promise<CloseResult> {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer)
      this.intervalTimer = undefined
    }

    this.closed = true
    this.messageQueue = []

    return { success: true, resourcesFreed: true }
  }

  private scheduleNextGeneration(): void {
    if (this.closed) {
      return
    }

    const interval = this.config.interval!
    const count = this.config.count

    this.intervalTimer = setTimeout(() => {
      if (this.closed) {
        return
      }

      if (count !== undefined && this.messageCount >= count) {
        return
      }

      this.messageQueue.push(this.generateMessage())
      this.scheduleNextGeneration()
    }, interval)
  }

  private generateMessage(): InputMessage {
    if (!this.ast) {
      throw new Error('Template not parsed')
    }

    const emptyMessage = new BenthosMessage({})
    const interpreter = new Interpreter(emptyMessage)
    const result = interpreter.evaluate(this.ast)

    let content: string
    if (typeof result === 'string') {
      content = result
    } else if (typeof result === 'object') {
      content = JSON.stringify(result)
    } else {
      content = String(result)
    }

    const metadata = new MessageMetadata(this.config.metadata)
    metadata.set('timestamp', new Date().toISOString())

    this.messageCount++

    return { content, metadata }
  }
}

// HttpServerInput Implementation
class HttpServerInput implements Input {
  private config: HttpServerInputConfig
  private started = false
  private closed = false
  private server?: any
  private requestQueue: InputMessage[] = []
  private pendingRequests: Array<{ resolve: (msg: InputMessage | null) => void }> = []

  constructor(config: HttpServerInputConfig) {
    this.config = {
      hostname: '0.0.0.0',
      path: '/messages',
      methods: ['POST'],
      ...config,
    }
  }

  async start(): Promise<StartResult> {
    if (this.closed) {
      this.closed = false
      this.requestQueue = []
      this.pendingRequests = []
    }

    try {
      if (this.config.port < 1 || this.config.port > 65535) {
        return {
          success: false,
          error: 'Invalid port number',
        }
      }

      await this.startServer()

      this.started = true
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      }
    }
  }

  async next(): Promise<InputMessage | null> {
    if (!this.started) {
      throw new Error('Input not started')
    }

    if (this.closed) {
      throw new Error('Input closed')
    }

    if (this.requestQueue.length > 0) {
      return this.requestQueue.shift()!
    }

    return null
  }

  async ack(_msg: InputMessage): Promise<AckResult> {
    return { success: true }
  }

  async close(): Promise<CloseResult> {
    if (this.server) {
      await this.stopServer()
      this.server = undefined
    }

    this.closed = true
    this.requestQueue = []

    for (const pending of this.pendingRequests) {
      pending.resolve(null)
    }
    this.pendingRequests = []

    return { success: true, resourcesFreed: true }
  }

  private async startServer(): Promise<void> {
    // Mock server for browser/worker/test environments
    this.server = {
      listening: true,
      close: () => Promise.resolve(),
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.server || !this.server.close) {
      return
    }
  }
}

// Output Types
export interface OutputMetrics {
  messagesWritten: number
  bytesSent: number
  errors: number
}

export interface Output {
  write(msg: BenthosMessage | BenthosBatch): Promise<void>
  close(): void
  isOpen: boolean
  metrics: OutputMetrics
}

export interface StdoutOutputConfig {
  type: 'stdout'
}

export interface DropOutputConfig {
  type: 'drop'
}

export interface HttpClientOutputConfig {
  type: 'http'
  url: string
  timeout?: number
  maxRetries?: number
  headers?: Record<string, string>
}

export type OutputConfig = StdoutOutputConfig | DropOutputConfig | HttpClientOutputConfig

/**
 * Base output class with common functionality
 */
export abstract class BaseOutput implements Output {
  protected _isOpen = true
  protected _metrics: OutputMetrics = {
    messagesWritten: 0,
    bytesSent: 0,
    errors: 0
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  get metrics(): OutputMetrics {
    return { ...this._metrics }
  }

  close(): void {
    this._isOpen = false
  }

  async write(msg: BenthosMessage | BenthosBatch): Promise<void> {
    if (!this._isOpen) {
      throw new Error('Output is closed')
    }

    if (!isMessage(msg) && !isBatch(msg)) {
      throw new Error('Invalid message type')
    }

    if (msg === null || msg === undefined) {
      throw new Error('Message cannot be null or undefined')
    }

    try {
      if (isBatch(msg)) {
        await this.writeBatch(msg)
      } else {
        await this.writeMessage(msg)
      }
    } catch (error) {
      this._metrics.errors++
      throw error
    }
  }

  protected abstract writeMessage(msg: BenthosMessage): Promise<void>

  protected async writeBatch(batch: BenthosBatch): Promise<void> {
    for (const msg of batch) {
      await this.writeMessage(msg)
    }
  }

  protected trackMessage(msg: BenthosMessage): void {
    this._metrics.messagesWritten++
    this._metrics.bytesSent += msg.bytes.length
  }
}

/**
 * Stdout output - writes messages to console
 */
export class StdoutOutput extends BaseOutput {
  protected async writeMessage(msg: BenthosMessage): Promise<void> {
    const content = msg.content

    let output: unknown
    try {
      output = JSON.parse(content)
    } catch {
      output = content
    }

    const metadataObj = msg.metadata.toObject()
    if (Object.keys(metadataObj).length > 0) {
      console.log(JSON.stringify({ ...output, _metadata: metadataObj }))
    } else {
      if (typeof output === 'string') {
        console.log(output)
      } else {
        console.log(JSON.stringify(output))
      }
    }

    this.trackMessage(msg)
  }
}

/**
 * Drop output - silently discards all messages
 */
export class DropOutput extends BaseOutput {
  protected async writeMessage(msg: BenthosMessage): Promise<void> {
    this.trackMessage(msg)
  }
}

/**
 * HTTP Client output - POSTs messages to configured URL
 */
export class HttpClientOutput extends BaseOutput {
  private url: string
  private timeout: number
  private maxRetries: number
  private defaultHeaders: Record<string, string>
  private customHeaders: Record<string, string>

  constructor(config: HttpClientOutputConfig) {
    super()

    try {
      new URL(config.url)
    } catch {
      throw new Error(`Invalid URL: ${config.url}`)
    }

    this.url = config.url
    this.timeout = config.timeout ?? 30000
    this.maxRetries = config.maxRetries ?? 3
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': 'benthos-dotdo/1.0'
    }
    this.customHeaders = config.headers ?? {}
  }

  protected async writeMessage(msg: BenthosMessage): Promise<void> {
    const body = msg.content
    const headers = this.buildHeaders(msg)

    await this.sendWithRetry(body, headers)
    this.trackMessage(msg)
  }

  protected async writeBatch(batch: BenthosBatch): Promise<void> {
    const messages = []
    for (const msg of batch) {
      try {
        messages.push(JSON.parse(msg.content))
      } catch {
        messages.push(msg.content)
      }
      this.trackMessage(msg)
    }

    const body = JSON.stringify(messages)
    const headers = this.buildHeaders()

    await this.sendWithRetry(body, headers)
  }

  private buildHeaders(msg?: BenthosMessage): Record<string, string> {
    const headers = {
      ...this.defaultHeaders,
      ...this.customHeaders
    }

    if (msg) {
      const metadataObj = msg.metadata.toObject()
      for (const [key, value] of Object.entries(metadataObj)) {
        headers[key] = value
      }
    }

    return headers
  }

  private async sendWithRetry(body: string, headers: Record<string, string>): Promise<void> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(body, headers)

        if (response.ok || (response.status >= 200 && response.status < 300)) {
          return
        }

        if (response.status >= 400 && response.status < 500) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
        }

        if (response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)

          if (attempt >= this.maxRetries) {
            throw lastError
          }

          const delay = Math.min(100 * Math.pow(2, attempt), 1000)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`)

      } catch (error) {
        if (error instanceof Error) {
          lastError = error

          if (error.message.includes('HTTP 4')) {
            throw error
          }

          if (attempt >= this.maxRetries) {
            throw error
          }

          const delay = Math.min(100 * Math.pow(2, attempt), 1000)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        throw error
      }
    }

    if (lastError) {
      throw lastError
    }
  }

  private async fetchWithTimeout(body: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      })
      return response
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout')
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

// Factory functions

export function createGenerateInput(config: GenerateInputConfig): Input {
  return new GenerateInput(config)
}

export function createHttpServerInput(config: HttpServerInputConfig): Input {
  return new HttpServerInput(config)
}

export function createOutput(config: OutputConfig): Output {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid output configuration')
  }

  switch (config.type) {
    case 'stdout':
      return new StdoutOutput()

    case 'drop':
      return new DropOutput()

    case 'http':
      if (!config.url) {
        throw new Error('HTTP output requires url configuration')
      }
      return new HttpClientOutput(config)

    default:
      throw new Error(`Unknown output type: ${(config as any).type}`)
  }
}

export function isOutput(obj: unknown): obj is Output {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const output = obj as any
  return (
    typeof output.write === 'function' &&
    typeof output.close === 'function' &&
    typeof output.isOpen === 'boolean' &&
    typeof output.metrics === 'object'
  )
}
