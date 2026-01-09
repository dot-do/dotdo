/**
 * HTTP Transport for @dotdo/client
 */

import type {
  RPCMessage,
  RPCResponse,
  ConnectionState,
  AuthConfig,
} from '../types'

type EventCallback = (data: unknown) => void

export interface HTTPTransportConfig {
  url: string
  auth?: AuthConfig
  maxRetries?: number
}

/**
 * HTTP fallback transport implementation
 */
export class HTTPTransport {
  private url: string
  private auth?: AuthConfig
  private maxRetries: number
  private _connectionState: ConnectionState = 'connected'
  private eventListeners: Map<string, Set<EventCallback>> = new Map()

  constructor(config: HTTPTransportConfig) {
    this.url = config.url + '/rpc'
    this.auth = config.auth
    this.maxRetries = config.maxRetries ?? 3
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  async send(message: RPCMessage): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }

        if (this.auth?.token) {
          headers['Authorization'] = `Bearer ${this.auth.token}`
        }

        const response = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
        })

        if (response.status >= 500) {
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }

        const data = await response.json() as RPCResponse
        this.emit('message', data)
        return
      } catch (e) {
        lastError = e as Error
      }
    }

    // If all retries failed, emit error response
    this.emit('message', {
      id: message.id,
      error: {
        code: 'HTTP_ERROR',
        message: lastError?.message || 'HTTP request failed',
      },
    })
  }

  on(event: string, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(callback)
  }

  off(event: string, callback: EventCallback): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(callback)
    }
  }

  disconnect(): void {
    this._connectionState = 'disconnected'
    this.eventListeners.clear()
  }

  private emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data)
        } catch (e) {
          console.error('Transport event listener error:', e)
        }
      }
    }
  }
}
