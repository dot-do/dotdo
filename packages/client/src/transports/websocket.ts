/**
 * WebSocket Transport for @dotdo/client
 */

import type {
  RPCMessage,
  RPCResponse,
  ConnectionState,
} from '../types'
import { httpToWs } from '../utils'

type EventCallback = (data: unknown) => void

export interface WebSocketTransportConfig {
  url: string
}

/**
 * WebSocket transport implementation
 */
export class WebSocketTransport {
  private url: string
  private wsUrl: string
  private ws: WebSocket | null = null
  private _connectionState: ConnectionState = 'connecting'
  private eventListeners: Map<string, Set<EventCallback>> = new Map()
  private explicitlyDisconnected = false

  constructor(config: WebSocketTransportConfig) {
    this.url = config.url
    this.wsUrl = httpToWs(config.url) + '/rpc'
    this.connect()
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  send(message: RPCMessage): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(message))
    }
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
    this.explicitlyDisconnected = true
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting')
      this.ws = null
    }
    this.setConnectionState('disconnected')
    this.eventListeners.clear()
  }

  /** Check if explicitly disconnected */
  get isDisconnected(): boolean {
    return this.explicitlyDisconnected
  }

  /** Reconnect the transport */
  reconnect(): void {
    if (!this.explicitlyDisconnected) {
      this.connect()
    }
  }

  private connect(): void {
    if (this.explicitlyDisconnected) return

    try {
      this.ws = new WebSocket(this.wsUrl)
      this.setConnectionState('connecting')

      this.ws.onopen = () => {
        this.setConnectionState('connected')
        this.emit('connectionStateChange', 'connected')
      }

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as RPCResponse
          this.emit('message', data)
        } catch {
          this.emit('error', new Error('Malformed server response'))
        }
      }

      this.ws.onclose = (event: CloseEvent) => {
        this.ws = null
        this.emit('close', event.reason || 'Connection closed')
        if (!this.explicitlyDisconnected) {
          this.setConnectionState('reconnecting')
        } else {
          this.setConnectionState('disconnected')
        }
      }

      this.ws.onerror = () => {
        // Error will be followed by close
      }
    } catch {
      this.setConnectionState('failed')
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state
      this.emit('connectionStateChange', state)
    }
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
