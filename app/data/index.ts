// Data Layer - Dual-Mode (REST/TanStack DB) Data Client
// Provides abstraction for data fetching with REST and real-time WebSocket sync

import { createLogger } from '../../utils/logger'

const logger = createLogger('[DataClient]')

export type DataMode = 'rest' | 'tanstack-db'

export interface DataClientOptions {
  /** Data mode - REST or TanStack DB (WebSocket sync) */
  mode: DataMode
  /** Base URL for API (http/https for REST, ws/wss for WebSocket) */
  baseUrl: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Enable optimistic updates (default: false) */
  optimistic?: boolean
  /** Enable client-side caching (default: false) */
  cache?: boolean
  /** Authentication token */
  token?: string
}

export interface Thing {
  $id: string
  $type: string
  [key: string]: unknown
}

export interface UpdateMessage {
  type: 'create' | 'update' | 'delete' | 'broadcast'
  resource: string
  id?: string
  data?: Thing
}

export type UpdateListener = (update: UpdateMessage) => void

/**
 * Data client for fetching and syncing data
 * Supports both REST mode and real-time TanStack DB mode
 */
export interface DataClient {
  /** Get a single item by ID */
  get(resource: string, id: string): Promise<Thing>

  /** List items in a resource */
  list(resource: string, query?: Record<string, unknown>): Promise<Thing[]>

  /** Create a new item */
  create(resource: string, data: Record<string, unknown>): Promise<Thing>

  /** Update an existing item */
  update(resource: string, id: string, data: Record<string, unknown>): Promise<Thing>

  /** Delete an item */
  delete(resource: string, id: string): Promise<void>

  /** Subscribe to real-time updates (TanStack DB mode) */
  onUpdate(listener: UpdateListener): () => void

  /** Get current mode */
  getMode(): DataMode

  /** Switch mode at runtime */
  setMode(mode: DataMode): void

  /** Disconnect WebSocket (if connected) */
  disconnect(): void

  /** Invalidate cache for a resource */
  invalidateCache(resource: string, id?: string): void
}

/**
 * REST client implementation
 */
class RESTClient implements DataClient {
  private baseUrl: string
  private timeout: number
  private optimistic: boolean
  private cache: boolean
  private token?: string | undefined
  private cacheStore: Map<string, Thing> = new Map()
  private updateListeners: Set<UpdateListener> = new Set()
  private optimisticCounter = 0

  constructor(options: DataClientOptions) {
    this.baseUrl = options.baseUrl
    this.timeout = options.timeout || 30000
    this.optimistic = options.optimistic || false
    this.cache = options.cache || false
    this.token = options.token
  }

  private getCacheKey(resource: string, id?: string): string {
    return id ? `${resource}/${id}` : resource
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return response
  }

  async get(resource: string, id: string): Promise<Thing> {
    const cacheKey = this.getCacheKey(resource, id)

    if (this.cache && this.cacheStore.has(cacheKey)) {
      return this.cacheStore.get(cacheKey)!
    }

    const url = `${this.baseUrl}/${resource}/${id}`
    const response = await this.fetchWithTimeout(url, { method: 'GET' })
    const data = (await response.json()) as Thing

    if (this.cache) {
      this.cacheStore.set(cacheKey, data)
    }

    return data
  }

  async list(resource: string, query?: Record<string, unknown>): Promise<Thing[]> {
    let url = `${this.baseUrl}/${resource}`

    if (query) {
      const params = new URLSearchParams(
        Object.fromEntries(
          Object.entries(query).map(([k, v]) => [k, String(v)])
        )
      )
      url += `?${params.toString()}`
    }

    const response = await this.fetchWithTimeout(url, { method: 'GET' })
    return response.json()
  }

  async create(resource: string, data: Record<string, unknown>): Promise<Thing> {
    if (this.optimistic) {
      const optimisticId = `optimistic-${++this.optimisticCounter}`
      const optimisticResult: Thing = {
        $id: optimisticId,
        $type: resource,
        ...data,
      }

      // Return optimistic result immediately
      setTimeout(async () => {
        try {
          const url = `${this.baseUrl}/${resource}`
          const response = await this.fetchWithTimeout(url, {
            method: 'POST',
            body: JSON.stringify(data),
          })
          const realResult = (await response.json()) as Thing

          // Notify listeners of the real result
          this.notifyListeners({
            type: 'create',
            resource,
            data: realResult,
          })

          // Update cache if enabled
          if (this.cache) {
            const cacheKey = this.getCacheKey(resource, realResult.$id)
            this.cacheStore.set(cacheKey, realResult)
          }
        } catch (error) {
          logger.error('Optimistic create failed:', error)
        }
      }, 0)

      return optimisticResult
    }

    const url = `${this.baseUrl}/${resource}`
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    const result = (await response.json()) as Thing

    if (this.cache) {
      const cacheKey = this.getCacheKey(resource, result.$id)
      this.cacheStore.set(cacheKey, result)
    }

    return result
  }

  async update(resource: string, id: string, data: Record<string, unknown>): Promise<Thing> {
    const url = `${this.baseUrl}/${resource}/${id}`
    const response = await this.fetchWithTimeout(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    const result = (await response.json()) as Thing

    // Invalidate cache
    if (this.cache) {
      const cacheKey = this.getCacheKey(resource, id)
      this.cacheStore.set(cacheKey, result)
    }

    return result
  }

  async delete(resource: string, id: string): Promise<void> {
    const url = `${this.baseUrl}/${resource}/${id}`
    await this.fetchWithTimeout(url, { method: 'DELETE' })

    // Invalidate cache
    if (this.cache) {
      const cacheKey = this.getCacheKey(resource, id)
      this.cacheStore.delete(cacheKey)
    }
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener)
    return () => {
      this.updateListeners.delete(listener)
    }
  }

  private notifyListeners(update: UpdateMessage): void {
    this.updateListeners.forEach((listener) => listener(update))
  }

  getMode(): DataMode {
    return 'rest'
  }

  setMode(_mode: DataMode): void {
    throw new Error('Cannot switch mode on REST client - create new client')
  }

  disconnect(): void {
    // No-op for REST
  }

  invalidateCache(resource: string, id?: string): void {
    if (!this.cache) return

    const cacheKey = this.getCacheKey(resource, id)
    if (id) {
      this.cacheStore.delete(cacheKey)
    } else {
      // Invalidate all items in resource
      for (const key of this.cacheStore.keys()) {
        if (key.startsWith(`${resource}/`)) {
          this.cacheStore.delete(key)
        }
      }
    }
  }
}

/**
 * TanStack DB (WebSocket) client implementation
 */
class TanStackDBClient implements DataClient {
  private ws: WebSocket | null = null
  private baseUrl: string
  private timeout: number
  private token?: string | undefined
  private pendingRequests: Map<string, (value: unknown) => void> = new Map()
  private requestCounter = 0
  private updateListeners: Set<UpdateListener> = new Set()
  private restFallback: RESTClient
  private connected = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5

  constructor(options: DataClientOptions) {
    this.baseUrl = options.baseUrl
    this.timeout = options.timeout || 30000
    this.token = options.token

    // Create REST fallback client
    const restUrl = this.baseUrl.replace(/^wss?:\/\//, 'https://')
    this.restFallback = new RESTClient({
      ...options,
      mode: 'rest',
      baseUrl: restUrl,
    })

    this.connect()
  }

  private connect(): void {
    const wsUrl = `${this.baseUrl}/sync`
    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.connected = true
      this.reconnectAttempts = 0
      logger.info('WebSocket connected')
    }

    this.ws.onclose = () => {
      this.connected = false
      logger.info('WebSocket disconnected')
      this.attemptReconnect()
    }

    this.ws.onerror = (error) => {
      logger.error('WebSocket error:', error)
      this.connected = false
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        this.handleMessage(message)
      } catch (error) {
        logger.error('Failed to parse WebSocket message:', error)
      }
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, giving up')
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)

    setTimeout(() => {
      logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)
      this.connect()
    }, delay)
  }

  private handleMessage(message: UpdateMessage & { requestId?: string }): void {
    // Handle request responses
    if (message.requestId && this.pendingRequests.has(message.requestId)) {
      const resolve = this.pendingRequests.get(message.requestId)!
      this.pendingRequests.delete(message.requestId)
      resolve(message.data)
      return
    }

    // Handle broadcasts
    if (message.type === 'broadcast') {
      this.notifyListeners(message)
    }
  }

  private async sendRequest(message: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Fallback to REST
      logger.warn('WebSocket not connected, falling back to REST')
      return this.fallbackToREST(message)
    }

    return new Promise((resolve, reject) => {
      const requestId = `req-${++this.requestCounter}`
      message['requestId'] = requestId

      this.pendingRequests.set(requestId, resolve)

      this.ws!.send(JSON.stringify(message))

      // Timeout handling
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId)
          reject(new Error('Request timeout'))
        }
      }, this.timeout)
    })
  }

  private async fallbackToREST(message: Record<string, unknown>): Promise<unknown> {
    const { type, resource, id, data } = message

    // Type guards to ensure proper types for REST fallback
    if (typeof resource !== 'string') {
      throw new Error('Resource must be a string')
    }

    switch (type) {
      case 'get':
        if (typeof id !== 'string') {
          throw new Error('ID must be a string for get operation')
        }
        return this.restFallback.get(resource, id)
      case 'list':
        return this.restFallback.list(resource, data as Record<string, unknown> | undefined)
      case 'create':
        if (!data || typeof data !== 'object') {
          throw new Error('Data must be an object for create operation')
        }
        return this.restFallback.create(resource, data as Record<string, unknown>)
      case 'update':
        if (typeof id !== 'string') {
          throw new Error('ID must be a string for update operation')
        }
        if (!data || typeof data !== 'object') {
          throw new Error('Data must be an object for update operation')
        }
        return this.restFallback.update(resource, id, data as Record<string, unknown>)
      case 'delete':
        if (typeof id !== 'string') {
          throw new Error('ID must be a string for delete operation')
        }
        return this.restFallback.delete(resource, id)
      default:
        throw new Error(`Unsupported operation: ${type}`)
    }
  }

  async get(resource: string, id: string): Promise<Thing> {
    const result = await this.sendRequest({ type: 'get', resource, id })
    return result as Thing
  }

  async list(resource: string, query?: Record<string, unknown>): Promise<Thing[]> {
    const result = await this.sendRequest({ type: 'list', resource, data: query })
    return result as Thing[]
  }

  async create(resource: string, data: Record<string, unknown>): Promise<Thing> {
    const result = await this.sendRequest({ type: 'create', resource, data })
    return result as Thing
  }

  async update(resource: string, id: string, data: Record<string, unknown>): Promise<Thing> {
    const result = await this.sendRequest({ type: 'update', resource, id, data })
    return result as Thing
  }

  async delete(resource: string, id: string): Promise<void> {
    await this.sendRequest({ type: 'delete', resource, id })
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener)
    return () => {
      this.updateListeners.delete(listener)
    }
  }

  private notifyListeners(update: UpdateMessage): void {
    this.updateListeners.forEach((listener) => listener(update))
  }

  getMode(): DataMode {
    return 'tanstack-db'
  }

  setMode(_mode: DataMode): void {
    throw new Error('Cannot switch mode on TanStack DB client - create new client')
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
      this.connected = false
    }
  }

  invalidateCache(resource: string, id?: string): void {
    this.restFallback.invalidateCache(resource, id)
  }
}

/**
 * Dual-mode client that can switch between REST and TanStack DB
 */
class DualModeClient implements DataClient {
  private currentMode: DataMode
  private currentClient: DataClient

  constructor(private options: DataClientOptions) {
    this.currentMode = options.mode
    this.currentClient = this.createClient(options.mode)
  }

  private createClient(mode: DataMode): DataClient {
    if (mode === 'rest') {
      return new RESTClient(this.options)
    } else {
      return new TanStackDBClient(this.options)
    }
  }

  async get(resource: string, id: string): Promise<Thing> {
    return this.currentClient.get(resource, id)
  }

  async list(resource: string, query?: Record<string, unknown>): Promise<Thing[]> {
    return this.currentClient.list(resource, query)
  }

  async create(resource: string, data: Record<string, unknown>): Promise<Thing> {
    return this.currentClient.create(resource, data)
  }

  async update(resource: string, id: string, data: Record<string, unknown>): Promise<Thing> {
    return this.currentClient.update(resource, id, data)
  }

  async delete(resource: string, id: string): Promise<void> {
    return this.currentClient.delete(resource, id)
  }

  onUpdate(listener: UpdateListener): () => void {
    return this.currentClient.onUpdate(listener)
  }

  getMode(): DataMode {
    return this.currentMode
  }

  setMode(mode: DataMode): void {
    if (mode === this.currentMode) return

    // Disconnect old client
    this.currentClient.disconnect()

    // Create new client
    this.currentMode = mode
    this.options.mode = mode
    this.currentClient = this.createClient(mode)
  }

  disconnect(): void {
    this.currentClient.disconnect()
  }

  invalidateCache(resource: string, id?: string): void {
    this.currentClient.invalidateCache(resource, id)
  }
}

/**
 * Create a data client with the specified options
 *
 * @example
 * ```typescript
 * // REST mode
 * const client = createDataClient({
 *   mode: 'rest',
 *   baseUrl: 'https://api.example.com',
 * })
 *
 * // TanStack DB mode with WebSocket sync
 * const client = createDataClient({
 *   mode: 'tanstack-db',
 *   baseUrl: 'wss://api.example.com',
 * })
 *
 * // With optimistic updates
 * const client = createDataClient({
 *   mode: 'rest',
 *   baseUrl: 'https://api.example.com',
 *   optimistic: true,
 * })
 * ```
 */
export function createDataClient(options: DataClientOptions): DataClient {
  return new DualModeClient(options)
}

