/**
 * PathDO - Path-based Sharding Durable Object
 *
 * One DO per path prefix for horizontal scaling.
 * Each PathDO manages a subtree of the database:
 * - Stores data at its path and below
 * - Handles real-time subscriptions for its subtree
 * - Delegates to child PathDOs for deeper paths
 *
 * @example
 * ```
 * /users           -> PathDO("users")
 * /users/alice     -> PathDO("users/alice")
 * /posts           -> PathDO("posts")
 * /posts/123       -> PathDO("posts/123")
 * ```
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  PATH_DO: DurableObjectNamespace
  FIREBASE_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

export interface DataSnapshot {
  key: string | null
  val(): unknown
  exists(): boolean
  child(path: string): DataSnapshot
  forEach(callback: (child: DataSnapshot) => boolean | void): boolean
  hasChildren(): boolean
  numChildren(): number
  toJSON(): unknown
  exportVal(): unknown
  priority: string | number | null
}

export interface WriteOperation {
  type: 'set' | 'update' | 'push' | 'remove' | 'transaction'
  path: string
  data?: unknown
  transactionUpdate?: (current: unknown) => unknown
}

export interface Listener {
  ws: WebSocket
  eventType: 'value' | 'child_added' | 'child_changed' | 'child_removed' | 'child_moved'
  path: string
  query?: QueryOptions
}

export interface QueryOptions {
  orderBy?: 'key' | 'value' | 'child' | 'priority'
  orderByChild?: string
  startAt?: unknown
  endAt?: unknown
  equalTo?: unknown
  limitToFirst?: number
  limitToLast?: number
}

export interface ServerTimestamp {
  '.sv': 'timestamp'
}

export interface Priority {
  '.priority': string | number
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

export function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

export function getPathSegments(path: string): string[] {
  const normalized = normalizePath(path)
  return normalized ? normalized.split('/') : []
}

export function getParentPath(path: string): string | null {
  const segments = getPathSegments(path)
  if (segments.length <= 1) return null
  return segments.slice(0, -1).join('/')
}

export function getChildKey(path: string): string | null {
  const segments = getPathSegments(path)
  return segments.length > 0 ? segments[segments.length - 1] : null
}

export function joinPaths(...paths: string[]): string {
  return normalizePath(paths.filter(Boolean).join('/'))
}

export function isChildPath(parentPath: string, childPath: string): boolean {
  const parent = normalizePath(parentPath)
  const child = normalizePath(childPath)
  if (!parent) return true
  return child.startsWith(parent + '/') || child === parent
}

export function getRelativePath(basePath: string, fullPath: string): string {
  const base = normalizePath(basePath)
  const full = normalizePath(fullPath)
  if (!base) return full
  if (full === base) return ''
  if (full.startsWith(base + '/')) {
    return full.slice(base.length + 1)
  }
  return full
}

// ============================================================================
// PUSH ID GENERATION
// ============================================================================

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'
let lastPushTime = 0
let lastRandChars: number[] = []

export function generatePushId(): string {
  let now = Date.now()
  const duplicateTime = now === lastPushTime
  lastPushTime = now

  const timeStampChars = new Array(8)
  for (let i = 7; i >= 0; i--) {
    timeStampChars[i] = PUSH_CHARS.charAt(now % 64)
    now = Math.floor(now / 64)
  }

  let id = timeStampChars.join('')

  if (!duplicateTime) {
    lastRandChars = []
    for (let i = 0; i < 12; i++) {
      lastRandChars.push(Math.floor(Math.random() * 64))
    }
  } else {
    let i = 11
    while (i >= 0 && lastRandChars[i] === 63) {
      lastRandChars[i] = 0
      i--
    }
    if (i >= 0) {
      lastRandChars[i]++
    }
  }

  for (let i = 0; i < 12; i++) {
    id += PUSH_CHARS.charAt(lastRandChars[i])
  }

  return id
}

// ============================================================================
// SNAPSHOT IMPLEMENTATION
// ============================================================================

export function createSnapshot(
  key: string | null,
  data: unknown,
  priority: string | number | null = null
): DataSnapshot {
  const snapshot: DataSnapshot = {
    key,
    priority,

    val(): unknown {
      if (data === undefined || data === null) return null
      // Strip metadata
      if (typeof data === 'object' && data !== null) {
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          if (!k.startsWith('.')) {
            result[k] = v
          }
        }
        return Object.keys(result).length > 0 ? result : null
      }
      return data
    },

    exists(): boolean {
      return data !== undefined && data !== null
    },

    child(childPath: string): DataSnapshot {
      const segments = getPathSegments(childPath)
      let current: unknown = data
      for (const segment of segments) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return createSnapshot(segments[segments.length - 1], null)
        }
        current = (current as Record<string, unknown>)[segment]
      }
      return createSnapshot(segments[segments.length - 1] || null, current)
    },

    forEach(callback: (child: DataSnapshot) => boolean | void): boolean {
      if (typeof data !== 'object' || data === null) return false
      for (const [childKey, childData] of Object.entries(data as Record<string, unknown>)) {
        if (childKey.startsWith('.')) continue
        const childSnapshot = createSnapshot(childKey, childData)
        if (callback(childSnapshot) === true) return true
      }
      return false
    },

    hasChildren(): boolean {
      if (typeof data !== 'object' || data === null) return false
      return Object.keys(data as Record<string, unknown>).some((k) => !k.startsWith('.'))
    },

    numChildren(): number {
      if (typeof data !== 'object' || data === null) return 0
      return Object.keys(data as Record<string, unknown>).filter((k) => !k.startsWith('.')).length
    },

    toJSON(): unknown {
      return snapshot.val()
    },

    exportVal(): unknown {
      return data
    },
  }

  return snapshot
}

// ============================================================================
// PATH DURABLE OBJECT
// ============================================================================

export class PathDO extends DurableObject<Env> {
  private listeners: Map<string, Listener[]> = new Map()
  private data: Record<string, unknown> = {}
  private initialized = false
  private basePath = ''

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  private async init(): Promise<void> {
    if (this.initialized) return

    // Load persisted data from SQLite
    const stored = await this.ctx.storage.get<Record<string, unknown>>('data')
    if (stored) {
      this.data = stored
    }

    const storedPath = await this.ctx.storage.get<string>('basePath')
    if (storedPath) {
      this.basePath = storedPath
    }

    this.initialized = true
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put('data', this.data)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    await this.init()

    const url = new URL(request.url)

    // WebSocket upgrade for real-time subscriptions
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API endpoints
    const path = normalizePath(url.pathname.replace('/api/', ''))

    switch (request.method) {
      case 'GET':
        return this.handleGet(path, url.searchParams)
      case 'PUT':
        return this.handleSet(path, request)
      case 'PATCH':
        return this.handleUpdate(path, request)
      case 'POST':
        return this.handlePush(path, request)
      case 'DELETE':
        return this.handleRemove(path)
      default:
        return new Response('Method Not Allowed', { status: 405 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REST HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleGet(path: string, params: URLSearchParams): Promise<Response> {
    const queryOptions = this.parseQueryParams(params)
    const data = this.getDataAtPath(path)
    let result = data

    // Apply query transformations
    if (queryOptions && typeof data === 'object' && data !== null) {
      result = this.applyQuery(data as Record<string, unknown>, queryOptions)
    }

    // Handle .json suffix (Firebase REST convention)
    if (result === undefined) {
      return Response.json(null)
    }

    return Response.json(result)
  }

  private async handleSet(path: string, request: Request): Promise<Response> {
    const body = await request.json()
    const processedData = this.processServerValues(body)

    this.setDataAtPath(path, processedData)
    await this.persist()

    // Notify listeners
    this.notifyListeners(path, 'value', processedData)
    this.notifyParentListeners(path, processedData)

    return Response.json(processedData)
  }

  private async handleUpdate(path: string, request: Request): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>
    const current = this.getDataAtPath(path) || {}

    if (typeof current !== 'object' || current === null) {
      return Response.json({ error: 'Cannot update non-object' }, { status: 400 })
    }

    // Multi-path update support
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      const processedValue = this.processServerValues(value)
      if (key.includes('/')) {
        // Multi-path update: key is a path relative to current location
        this.setDataAtPath(joinPaths(path, key), processedValue)
        updates[key] = processedValue
      } else {
        // Simple update
        ;(current as Record<string, unknown>)[key] = processedValue
        updates[key] = processedValue
      }
    }

    if (!Object.keys(body).some((k) => k.includes('/'))) {
      this.setDataAtPath(path, current)
    }

    await this.persist()

    // Notify listeners
    this.notifyListeners(path, 'value', this.getDataAtPath(path))
    for (const [key, value] of Object.entries(updates)) {
      const childPath = key.includes('/') ? joinPaths(path, key) : joinPaths(path, key)
      this.notifyListeners(childPath, 'value', value)
    }

    return Response.json(updates)
  }

  private async handlePush(path: string, request: Request): Promise<Response> {
    const body = await request.json()
    const processedData = this.processServerValues(body)
    const pushId = generatePushId()
    const childPath = joinPaths(path, pushId)

    this.setDataAtPath(childPath, processedData)
    await this.persist()

    // Notify listeners
    this.notifyListeners(path, 'child_added', processedData, pushId)
    this.notifyListeners(childPath, 'value', processedData)

    return Response.json({ name: pushId })
  }

  private async handleRemove(path: string): Promise<Response> {
    const oldData = this.getDataAtPath(path)
    this.removeDataAtPath(path)
    await this.persist()

    // Notify listeners
    this.notifyListeners(path, 'value', null)
    const parentPath = getParentPath(path)
    const childKey = getChildKey(path)
    if (parentPath !== null && childKey) {
      this.notifyListeners(parentPath, 'child_removed', oldData, childKey)
    }

    return Response.json(null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private getDataAtPath(path: string): unknown {
    const segments = getPathSegments(path)
    let current: unknown = this.data

    for (const segment of segments) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
    }

    return current
  }

  private setDataAtPath(path: string, value: unknown): void {
    const segments = getPathSegments(path)

    if (segments.length === 0) {
      this.data = value as Record<string, unknown>
      return
    }

    let current: Record<string, unknown> = this.data
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      if (!(segment in current) || typeof current[segment] !== 'object' || current[segment] === null) {
        current[segment] = {}
      }
      current = current[segment] as Record<string, unknown>
    }

    const lastSegment = segments[segments.length - 1]
    if (value === null || value === undefined) {
      delete current[lastSegment]
    } else {
      current[lastSegment] = value
    }
  }

  private removeDataAtPath(path: string): void {
    this.setDataAtPath(path, null)
  }

  private processServerValues(data: unknown): unknown {
    if (data === null || data === undefined) return data

    if (typeof data === 'object') {
      if ('.sv' in (data as Record<string, unknown>)) {
        const sv = (data as ServerTimestamp)['.sv']
        if (sv === 'timestamp') {
          return Date.now()
        }
      }

      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        result[key] = this.processServerValues(value)
      }
      return result
    }

    return data
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private parseQueryParams(params: URLSearchParams): QueryOptions | null {
    const options: QueryOptions = {}
    let hasQuery = false

    const orderByKey = params.get('orderByKey')
    const orderByChild = params.get('orderByChild')
    const orderByValue = params.get('orderByValue')
    const orderByPriority = params.get('orderByPriority')

    if (orderByKey === 'true' || orderByKey === '') {
      options.orderBy = 'key'
      hasQuery = true
    } else if (orderByChild) {
      options.orderBy = 'child'
      options.orderByChild = orderByChild
      hasQuery = true
    } else if (orderByValue === 'true' || orderByValue === '') {
      options.orderBy = 'value'
      hasQuery = true
    } else if (orderByPriority === 'true' || orderByPriority === '') {
      options.orderBy = 'priority'
      hasQuery = true
    }

    const startAt = params.get('startAt')
    if (startAt !== null) {
      options.startAt = JSON.parse(startAt)
      hasQuery = true
    }

    const endAt = params.get('endAt')
    if (endAt !== null) {
      options.endAt = JSON.parse(endAt)
      hasQuery = true
    }

    const equalTo = params.get('equalTo')
    if (equalTo !== null) {
      options.equalTo = JSON.parse(equalTo)
      hasQuery = true
    }

    const limitToFirst = params.get('limitToFirst')
    if (limitToFirst !== null) {
      options.limitToFirst = parseInt(limitToFirst, 10)
      hasQuery = true
    }

    const limitToLast = params.get('limitToLast')
    if (limitToLast !== null) {
      options.limitToLast = parseInt(limitToLast, 10)
      hasQuery = true
    }

    return hasQuery ? options : null
  }

  private applyQuery(data: Record<string, unknown>, options: QueryOptions): unknown {
    let entries = Object.entries(data).filter(([k]) => !k.startsWith('.'))

    // Sort
    if (options.orderBy === 'key') {
      entries.sort(([a], [b]) => a.localeCompare(b))
    } else if (options.orderBy === 'value') {
      entries.sort(([, a], [, b]) => this.compareValues(a, b))
    } else if (options.orderBy === 'child' && options.orderByChild) {
      const childKey = options.orderByChild
      entries.sort(([, a], [, b]) => {
        const aVal = typeof a === 'object' && a !== null ? (a as Record<string, unknown>)[childKey] : null
        const bVal = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)[childKey] : null
        return this.compareValues(aVal, bVal)
      })
    } else if (options.orderBy === 'priority') {
      entries.sort(([, a], [, b]) => {
        const aPriority = typeof a === 'object' && a !== null ? (a as Priority)['.priority'] : null
        const bPriority = typeof b === 'object' && b !== null ? (b as Priority)['.priority'] : null
        return this.compareValues(aPriority, bPriority)
      })
    }

    // Filter
    if (options.startAt !== undefined || options.endAt !== undefined || options.equalTo !== undefined) {
      entries = entries.filter(([key, value]) => {
        const sortValue = this.getSortValue(key, value, options)
        if (options.equalTo !== undefined) {
          return this.compareValues(sortValue, options.equalTo) === 0
        }
        if (options.startAt !== undefined && this.compareValues(sortValue, options.startAt) < 0) {
          return false
        }
        if (options.endAt !== undefined && this.compareValues(sortValue, options.endAt) > 0) {
          return false
        }
        return true
      })
    }

    // Limit
    if (options.limitToFirst !== undefined) {
      entries = entries.slice(0, options.limitToFirst)
    } else if (options.limitToLast !== undefined) {
      entries = entries.slice(-options.limitToLast)
    }

    return Object.fromEntries(entries)
  }

  private getSortValue(key: string, value: unknown, options: QueryOptions): unknown {
    if (options.orderBy === 'key') return key
    if (options.orderBy === 'value') return value
    if (options.orderBy === 'child' && options.orderByChild) {
      return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[options.orderByChild]
        : null
    }
    if (options.orderBy === 'priority') {
      return typeof value === 'object' && value !== null ? (value as Priority)['.priority'] : null
    }
    return key
  }

  private compareValues(a: unknown, b: unknown): number {
    // Firebase ordering: null < boolean < number < string < object
    const typeOrder = (v: unknown): number => {
      if (v === null || v === undefined) return 0
      if (typeof v === 'boolean') return 1
      if (typeof v === 'number') return 2
      if (typeof v === 'string') return 3
      return 4
    }

    const typeA = typeOrder(a)
    const typeB = typeOrder(b)

    if (typeA !== typeB) return typeA - typeB

    if (a === null || a === undefined) return 0
    if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0)
    if (typeof a === 'number') return (a as number) - (b as number)
    if (typeof a === 'string') return (a as string).localeCompare(b as string)

    return 0
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET / REAL-TIME
  // ═══════════════════════════════════════════════════════════════════════════

  private handleWebSocketUpgrade(_request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    this.ctx.acceptWebSocket(server)

    // Send initial connection acknowledgment
    server.send(
      JSON.stringify({
        t: 'c',
        d: {
          t: 'h',
          d: {
            ts: Date.now(),
            v: '5',
            h: 'dotdo-realtime.firebaseio.com',
            s: this.generateSessionId(),
          },
        },
      })
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = JSON.parse(data)

      await this.handleFirebaseMessage(ws, msg)
    } catch (error) {
      ws.send(
        JSON.stringify({
          t: 'd',
          d: {
            r: 0,
            b: {
              s: 'error',
              d: error instanceof Error ? error.message : 'Unknown error',
            },
          },
        })
      )
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Remove all listeners for this WebSocket
    for (const [path, listeners] of this.listeners) {
      const remaining = listeners.filter((l) => l.ws !== ws)
      if (remaining.length === 0) {
        this.listeners.delete(path)
      } else {
        this.listeners.set(path, remaining)
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  private async handleFirebaseMessage(ws: WebSocket, msg: { t: string; d: unknown }): Promise<void> {
    if (msg.t === 'd') {
      const data = msg.d as { r: number; a: string; b: { p: string; q?: QueryOptions; d?: unknown; h?: string } }
      const { r: requestId, a: action, b: body } = data

      switch (action) {
        case 'q': // Query (listen)
          await this.handleListen(ws, requestId, body.p, body.q, body.h)
          break
        case 'n': // Unlisten
          this.handleUnlisten(ws, body.p)
          this.sendResponse(ws, requestId, 'ok', {})
          break
        case 'p': // Put (set)
          await this.handlePut(ws, requestId, body.p, body.d)
          break
        case 'm': // Merge (update)
          await this.handleMerge(ws, requestId, body.p, body.d as Record<string, unknown>)
          break
        case 'o': // onDisconnect
          // Store disconnect operations (simplified - full impl would persist)
          this.sendResponse(ws, requestId, 'ok', {})
          break
        case 's': // Stats
          this.sendResponse(ws, requestId, 'ok', {})
          break
      }
    }
  }

  private async handleListen(
    ws: WebSocket,
    requestId: number,
    path: string,
    query?: QueryOptions,
    hash?: string
  ): Promise<void> {
    const normalizedPath = normalizePath(path)

    // Add listener
    const listener: Listener = {
      ws,
      eventType: 'value',
      path: normalizedPath,
      query,
    }

    const existing = this.listeners.get(normalizedPath) || []
    existing.push(listener)
    this.listeners.set(normalizedPath, existing)

    // Send current data
    let data = this.getDataAtPath(normalizedPath)
    if (query && typeof data === 'object' && data !== null) {
      data = this.applyQuery(data as Record<string, unknown>, query)
    }

    // Send initial data
    ws.send(
      JSON.stringify({
        t: 'd',
        d: {
          r: requestId,
          b: { s: 'ok', d: {} },
        },
      })
    )

    // Send data event
    ws.send(
      JSON.stringify({
        t: 'd',
        d: {
          a: 'd',
          b: {
            p: path,
            d: data ?? null,
          },
        },
      })
    )
  }

  private handleUnlisten(ws: WebSocket, path: string): void {
    const normalizedPath = normalizePath(path)
    const existing = this.listeners.get(normalizedPath) || []
    const remaining = existing.filter((l) => l.ws !== ws)

    if (remaining.length === 0) {
      this.listeners.delete(normalizedPath)
    } else {
      this.listeners.set(normalizedPath, remaining)
    }
  }

  private async handlePut(ws: WebSocket, requestId: number, path: string, data: unknown): Promise<void> {
    const normalizedPath = normalizePath(path)
    const processedData = this.processServerValues(data)

    this.setDataAtPath(normalizedPath, processedData)
    await this.persist()

    // Notify all listeners
    this.notifyListeners(normalizedPath, 'value', processedData)
    this.notifyParentListeners(normalizedPath, processedData)

    this.sendResponse(ws, requestId, 'ok', {})
  }

  private async handleMerge(
    ws: WebSocket,
    requestId: number,
    path: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const normalizedPath = normalizePath(path)
    const current = (this.getDataAtPath(normalizedPath) as Record<string, unknown>) || {}

    for (const [key, value] of Object.entries(data)) {
      const processedValue = this.processServerValues(value)
      if (key.includes('/')) {
        this.setDataAtPath(joinPaths(normalizedPath, key), processedValue)
      } else {
        current[key] = processedValue
      }
    }

    if (!Object.keys(data).some((k) => k.includes('/'))) {
      this.setDataAtPath(normalizedPath, current)
    }

    await this.persist()

    // Notify listeners
    this.notifyListeners(normalizedPath, 'value', this.getDataAtPath(normalizedPath))

    this.sendResponse(ws, requestId, 'ok', {})
  }

  private sendResponse(ws: WebSocket, requestId: number, status: string, data: unknown): void {
    try {
      ws.send(
        JSON.stringify({
          t: 'd',
          d: {
            r: requestId,
            b: { s: status, d: data },
          },
        })
      )
    } catch {
      // WebSocket closed
    }
  }

  private notifyListeners(path: string, eventType: string, data: unknown, childKey?: string): void {
    // Notify exact path listeners
    const listeners = this.listeners.get(path) || []
    for (const listener of listeners) {
      try {
        listener.ws.send(
          JSON.stringify({
            t: 'd',
            d: {
              a: 'd',
              b: {
                p: path,
                d: eventType === 'value' ? data : { [childKey!]: data },
              },
            },
          })
        )
      } catch {
        // WebSocket closed
      }
    }
  }

  private notifyParentListeners(path: string, data: unknown): void {
    // Notify parent path listeners about child changes
    const childKey = getChildKey(path)
    const parentPath = getParentPath(path)

    if (parentPath !== null && childKey) {
      const listeners = this.listeners.get(parentPath) || []
      for (const listener of listeners) {
        try {
          // Send the full parent data with the updated child
          const parentData = this.getDataAtPath(parentPath)
          listener.ws.send(
            JSON.stringify({
              t: 'd',
              d: {
                a: 'd',
                b: {
                  p: parentPath,
                  d: parentData,
                },
              },
            })
          )
        } catch {
          // WebSocket closed
        }
      }

      // Recurse to grandparents
      this.notifyParentListeners(parentPath, this.getDataAtPath(parentPath))
    }
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set path context for this DO
   */
  async setBasePath(path: string): Promise<void> {
    this.basePath = normalizePath(path)
    await this.ctx.storage.put('basePath', this.basePath)
  }

  /**
   * Direct get for DO-to-DO calls
   */
  async get(path: string): Promise<unknown> {
    await this.init()
    return this.getDataAtPath(path)
  }

  /**
   * Direct set for DO-to-DO calls
   */
  async set(path: string, data: unknown): Promise<void> {
    await this.init()
    const processedData = this.processServerValues(data)
    this.setDataAtPath(path, processedData)
    await this.persist()
    this.notifyListeners(path, 'value', processedData)
    this.notifyParentListeners(path, processedData)
  }

  /**
   * Direct update for DO-to-DO calls
   */
  async update(path: string, data: Record<string, unknown>): Promise<void> {
    await this.init()
    const current = (this.getDataAtPath(path) as Record<string, unknown>) || {}

    for (const [key, value] of Object.entries(data)) {
      const processedValue = this.processServerValues(value)
      if (key.includes('/')) {
        this.setDataAtPath(joinPaths(path, key), processedValue)
      } else {
        current[key] = processedValue
      }
    }

    if (!Object.keys(data).some((k) => k.includes('/'))) {
      this.setDataAtPath(path, current)
    }

    await this.persist()
    this.notifyListeners(path, 'value', this.getDataAtPath(path))
  }

  /**
   * Direct push for DO-to-DO calls
   */
  async push(path: string, data: unknown): Promise<string> {
    await this.init()
    const processedData = this.processServerValues(data)
    const pushId = generatePushId()
    const childPath = joinPaths(path, pushId)

    this.setDataAtPath(childPath, processedData)
    await this.persist()

    this.notifyListeners(path, 'child_added', processedData, pushId)
    this.notifyListeners(childPath, 'value', processedData)

    return pushId
  }

  /**
   * Direct remove for DO-to-DO calls
   */
  async remove(path: string): Promise<void> {
    await this.init()
    const oldData = this.getDataAtPath(path)
    this.removeDataAtPath(path)
    await this.persist()

    this.notifyListeners(path, 'value', null)
    const parentPath = getParentPath(path)
    const childKey = getChildKey(path)
    if (parentPath !== null && childKey) {
      this.notifyListeners(parentPath, 'child_removed', oldData, childKey)
    }
  }

  /**
   * Transaction for DO-to-DO calls
   */
  async transaction(path: string, updateFn: (current: unknown) => unknown): Promise<{ committed: boolean; snapshot: DataSnapshot }> {
    await this.init()

    const currentData = this.getDataAtPath(path)
    const newData = updateFn(currentData)

    if (newData === undefined) {
      // Transaction aborted
      return {
        committed: false,
        snapshot: createSnapshot(getChildKey(path), currentData),
      }
    }

    const processedData = this.processServerValues(newData)
    this.setDataAtPath(path, processedData)
    await this.persist()

    this.notifyListeners(path, 'value', processedData)
    this.notifyParentListeners(path, processedData)

    return {
      committed: true,
      snapshot: createSnapshot(getChildKey(path), processedData),
    }
  }

  /**
   * Get data with query for DO-to-DO calls
   */
  async query(path: string, options: QueryOptions): Promise<unknown> {
    await this.init()
    const data = this.getDataAtPath(path)

    if (typeof data !== 'object' || data === null) {
      return data
    }

    return this.applyQuery(data as Record<string, unknown>, options)
  }
}

export default PathDO
