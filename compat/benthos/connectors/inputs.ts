/**
 * Benthos Input Connectors
 * Issue: dotdo-x88jv
 *
 * Implements Input interface with GenerateInput and HttpServerInput connectors.
 * GenerateInput uses Bloblang templates to generate messages.
 * HttpServerInput accepts HTTP requests and converts them to messages.
 */

import { BenthosMessage, createMessage, MessageMetadata } from '../core/message'
import { parse } from '../bloblang/parser'
import { Interpreter, createInterpreterContext } from '../bloblang/interpreter'
import type { ASTNode } from '../bloblang/ast'

// ============================================================================
// Type Definitions
// ============================================================================

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

export type NextResult = InputMessage | null

export interface InputMessage {
  content: string
  metadata: MessageMetadata
}

/**
 * Base Input interface for all Benthos input connectors
 */
export interface Input {
  start(): Promise<StartResult>
  next(): Promise<InputMessage | null>
  ack(msg: InputMessage): Promise<AckResult>
  close(): Promise<CloseResult>
}

/**
 * Configuration for GenerateInput
 */
export interface GenerateInputConfig {
  template: string
  count?: number
  interval?: number
  batchSize?: number
  metadata?: Record<string, string>
}

/**
 * Configuration for HttpServerInput
 */
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

// ============================================================================
// GenerateInput Implementation
// ============================================================================

class GenerateInput implements Input {
  private config: GenerateInputConfig
  private started = false
  private closed = false
  private messageCount = 0
  private ast?: ASTNode
  private parseError?: Error
  private intervalTimer?: NodeJS.Timeout
  private messageQueue: InputMessage[] = []
  private generating = false

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
      // Parse the Bloblang template
      this.ast = parse(this.config.template)
      this.started = true
      this.parseError = undefined

      // Start generating if we have an interval
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

    // If there's a parse error, we can't generate
    if (this.parseError) {
      return null
    }

    // Check if we've reached the count limit
    const count = this.config.count
    if (count !== undefined && this.messageCount >= count) {
      return null
    }

    // If we have queued messages, return one
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!
    }

    // Generate messages based on configuration
    const batchSize = this.config.batchSize ?? 1
    const interval = this.config.interval

    // If we have an interval, wait for the next scheduled generation
    if (interval !== undefined && interval > 0) {
      // Wait for messages to be generated
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

    // Generate messages synchronously if no interval
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

  async ack(msg: InputMessage): Promise<AckResult> {
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
    if (this.closed || this.generating) {
      return
    }

    const interval = this.config.interval!
    const count = this.config.count

    this.intervalTimer = setTimeout(() => {
      if (this.closed) {
        return
      }

      // Check if we've reached the count limit
      if (count !== undefined && this.messageCount >= count) {
        return
      }

      // Generate a message
      this.messageQueue.push(this.generateMessage())

      // Schedule the next generation
      this.scheduleNextGeneration()
    }, interval)
  }

  private generateMessage(): InputMessage {
    if (!this.ast) {
      throw new Error('Template not parsed')
    }

    // Create an empty message context for evaluation
    const emptyMessage = new BenthosMessage({})

    // Create interpreter with the message
    const interpreter = new Interpreter(emptyMessage)

    // Evaluate the template
    const result = interpreter.evaluate(this.ast)

    // Convert result to string content
    let content: string
    if (typeof result === 'string') {
      content = result
    } else if (typeof result === 'object') {
      content = JSON.stringify(result)
    } else {
      content = String(result)
    }

    // Create metadata
    const metadata = new MessageMetadata(this.config.metadata)
    metadata.set('timestamp', new Date().toISOString())
    if (this.config.metadata?.['generator-id']) {
      // Custom metadata already set
    }

    this.messageCount++

    return {
      content,
      metadata,
    }
  }
}

// ============================================================================
// HttpServerInput Implementation
// ============================================================================

// Simple HTTP server implementation using Node.js http module
// In a real implementation, this would use a proper HTTP server
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
      // Validate port
      if (this.config.port < 1 || this.config.port > 65535) {
        return {
          success: false,
          error: 'Invalid port number',
        }
      }

      // Start the HTTP server
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

    // If we have queued requests, return one
    if (this.requestQueue.length > 0) {
      return this.requestQueue.shift()!
    }

    // Return null immediately if no requests are queued
    // In a real implementation, this might wait with a timeout
    return null
  }

  async ack(msg: InputMessage): Promise<AckResult> {
    return { success: true }
  }

  async close(): Promise<CloseResult> {
    if (this.server) {
      await this.stopServer()
      this.server = undefined
    }

    this.closed = true
    this.requestQueue = []

    // Reject all pending requests
    for (const pending of this.pendingRequests) {
      pending.resolve(null)
    }
    this.pendingRequests = []

    return { success: true, resourcesFreed: true }
  }

  private async startServer(): Promise<void> {
    // Check if we're in a Node.js environment
    if (typeof process === 'undefined' || typeof require === 'undefined') {
      // Mock server for browser/worker environments
      this.server = {
        listening: true,
        close: () => Promise.resolve(),
      }
      return
    }

    try {
      const http = await import('http')

      this.server = http.createServer((req: any, res: any) => {
        this.handleRequest(req, res)
      })

      return new Promise((resolve, reject) => {
        this.server!.on('error', (error: any) => {
          if (error.code === 'EADDRINUSE') {
            reject(new Error('Port already in use'))
          } else {
            reject(error)
          }
        })

        this.server!.listen(this.config.port, this.config.hostname, () => {
          resolve()
        })
      })
    } catch (error) {
      throw new Error(`Failed to start server: ${(error as Error).message}`)
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.server || !this.server.close) {
      return
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        resolve()
      })
    })
  }

  private async handleRequest(req: any, res: any): Promise<void> {
    // Check method
    const methods = this.config.methods ?? ['POST']
    if (!methods.includes(req.method)) {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method Not Allowed')
      return
    }

    // Check path
    if (this.config.path && req.url !== this.config.path) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }

    // Read body
    let body = ''
    req.on('data', (chunk: any) => {
      body += chunk.toString()

      // Check max body size
      if (this.config.maxBodySize && body.length > this.config.maxBodySize) {
        res.writeHead(413, { 'Content-Type': 'text/plain' })
        res.end('Payload Too Large')
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        // Parse body based on content type
        const contentType = req.headers['content-type'] || 'application/json'

        if (this.config.contentType && !contentType.includes(this.config.contentType)) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Invalid Content-Type')
          return
        }

        let content = body

        // Validate content based on type
        if (contentType.includes('application/json')) {
          try {
            JSON.parse(body)
          } catch {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Invalid JSON')
            return
          }
        }

        // Extract metadata from headers
        const metadata = new MessageMetadata()

        // Extract configured headers
        if (this.config.extractHeaders) {
          const prefix = this.config.headerPrefix ?? ''
          for (const header of this.config.extractHeaders) {
            const value = req.headers[header.toLowerCase()]
            if (value) {
              metadata.set(`${prefix}${header}`, String(value))
            }
          }
        }

        // Add standard metadata
        metadata.set('content-type', contentType)
        metadata.set('method', req.method)
        metadata.set('path', req.url)
        metadata.set('host', req.headers.host || '')
        metadata.set('url', req.url)

        // Extract path parameters if configured
        if (this.config.pathParams && this.config.path) {
          // Simple path parameter extraction
          const pathParts = this.config.path.split('/')
          const urlParts = req.url.split('/')

          for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i].startsWith(':')) {
              const paramName = pathParts[i].slice(1)
              if (this.config.pathParams.includes(paramName)) {
                metadata.set(paramName, urlParts[i] || '')
              }
            }
          }
        }

        const message: InputMessage = {
          content,
          metadata,
        }

        // Queue the message
        this.requestQueue.push(message)

        // Resolve any pending next() calls
        if (this.pendingRequests.length > 0) {
          const pending = this.pendingRequests.shift()!
          pending.resolve(message)
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('OK')
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      }
    })
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a GenerateInput instance
 */
export function createGenerateInput(config: GenerateInputConfig): Input {
  return new GenerateInput(config)
}

/**
 * Create an HttpServerInput instance
 */
export function createHttpServerInput(config: HttpServerInputConfig): Input {
  return new HttpServerInput(config)
}
