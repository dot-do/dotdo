/**
 * Benthos Output Connectors
 * Issue: dotdo-phvqg (RED → GREEN phase)
 *
 * Implements stdout, drop, and http_client outputs for Benthos compatibility
 */

import { BenthosMessage, BenthosBatch, isMessage, isBatch } from '../core/message'

/**
 * Output metrics tracking
 */
export interface OutputMetrics {
  messagesWritten: number
  bytesSent: number
  errors: number
}

/**
 * Base output interface
 */
export interface Output {
  write(msg: BenthosMessage | BenthosBatch): Promise<void>
  close(): void
  isOpen: boolean
  metrics: OutputMetrics
}

/**
 * Configuration for stdout output
 */
export interface StdoutOutputConfig {
  type: 'stdout'
}

/**
 * Configuration for drop output
 */
export interface DropOutputConfig {
  type: 'drop'
}

/**
 * Configuration for HTTP client output
 */
export interface HttpClientOutputConfig {
  type: 'http'
  url: string
  timeout?: number
  maxRetries?: number
  headers?: Record<string, string>
}

/**
 * Union type of all output configs
 */
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

    // Validate input
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

    // Try to parse as JSON to get structured output
    let output: unknown
    try {
      output = JSON.parse(content)
    } catch {
      // If not JSON, just use the string content
      output = content
    }

    // If there's metadata, include it in the output
    const metadataObj = msg.metadata.toObject()
    if (Object.keys(metadataObj).length > 0) {
      // Output as JSON with metadata
      console.log(JSON.stringify({ ...output, _metadata: metadataObj }))
    } else {
      // Output just the content
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
    // Silently discard, but still track metrics
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

    // Validate URL
    try {
      new URL(config.url)
    } catch {
      throw new Error(`Invalid URL: ${config.url}`)
    }

    this.url = config.url
    this.timeout = config.timeout ?? 30000 // 30 second default
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
    // Send batch as JSON array
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

    // Add metadata as headers if message provided
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
          return // Success
        }

        // Check if error is retryable (5xx) or permanent (4xx)
        if (response.status >= 400 && response.status < 500) {
          // 4xx errors are permanent, don't retry
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
        }

        // 5xx errors are retryable
        if (response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`)

          // Don't retry if we've exhausted attempts
          if (attempt >= this.maxRetries) {
            throw lastError
          }

          // Exponential backoff (but keep delays short for tests)
          const delay = Math.min(100 * Math.pow(2, attempt), 1000)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }

        // Other status codes (3xx, etc.)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)

      } catch (error) {
        // Network errors, timeouts, etc.
        if (error instanceof Error) {
          lastError = error

          // Check if it's a permanent error (don't retry for invalid URLs, etc.)
          if (error.message.includes('HTTP 4')) {
            throw error
          }

          // Retry on network errors
          if (attempt >= this.maxRetries) {
            throw error
          }

          // Exponential backoff
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

/**
 * Factory function to create outputs
 */
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

/**
 * Type guard for Output
 */
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
