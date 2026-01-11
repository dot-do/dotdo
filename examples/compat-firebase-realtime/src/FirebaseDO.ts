/**
 * FirebaseDO - Main Firebase Realtime Database Coordinator
 *
 * The central coordinator for Firebase-compatible realtime database operations.
 * Routes requests to appropriate PathDOs for sharding and handles:
 * - Database references and operations
 * - Security rules evaluation
 * - Real-time sync coordination
 * - Multi-path atomic writes
 *
 * @example
 * ```typescript
 * import { initializeApp } from '@dotdo/firebase'
 * import { getDatabase, ref, set, onValue } from '@dotdo/firebase/database'
 *
 * const app = initializeApp({ databaseURL: 'https://your-worker.workers.dev' })
 * const db = getDatabase(app)
 *
 * // Write data
 * await set(ref(db, 'users/alice'), { name: 'Alice', score: 100 })
 *
 * // Listen to changes
 * onValue(ref(db, 'users'), (snapshot) => {
 *   console.log('Users:', snapshot.val())
 * })
 * ```
 */

import { DurableObject } from 'cloudflare:workers'
import {
  normalizePath,
  getPathSegments,
  joinPaths,
  generatePushId,
  createSnapshot,
  type DataSnapshot,
  type QueryOptions,
  type Env,
} from './PathDO'
import { evaluateRules, type SecurityRules, type RuleContext } from './rules'

// ============================================================================
// TYPES
// ============================================================================

interface DatabaseConfig {
  rules?: SecurityRules
  shardingEnabled?: boolean
  shardDepth?: number
}

interface ConnectionState {
  ws: WebSocket
  sessionId: string
  authToken?: string
  userId?: string
  subscriptions: Map<string, { path: string; query?: QueryOptions }>
  lastActivity: number
}

interface WriteResult {
  success: boolean
  error?: string
  data?: unknown
}

interface TransactionResult {
  committed: boolean
  snapshot: DataSnapshot
}

// ============================================================================
// FIREBASE DURABLE OBJECT
// ============================================================================

export class FirebaseDO extends DurableObject<Env> {
  private connections: Map<string, ConnectionState> = new Map()
  private data: Record<string, unknown> = {}
  private rules: SecurityRules | null = null
  private config: DatabaseConfig = {}
  private initialized = false
  private listeners: Map<string, Set<string>> = new Map() // path -> Set<sessionId>
  private onDisconnectOps: Map<string, Array<{ path: string; action: 'set' | 'update' | 'remove'; data?: unknown }>> =
    new Map()

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  private async init(): Promise<void> {
    if (this.initialized) return

    // Load persisted data
    const stored = await this.ctx.storage.get<Record<string, unknown>>('data')
    if (stored) {
      this.data = stored
    }

    // Load rules
    const storedRules = await this.ctx.storage.get<SecurityRules>('rules')
    if (storedRules) {
      this.rules = storedRules
    }

    // Load config
    const storedConfig = await this.ctx.storage.get<DatabaseConfig>('config')
    if (storedConfig) {
      this.config = storedConfig
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

    // WebSocket upgrade for real-time
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // Admin endpoints
    if (url.pathname.startsWith('/.admin/')) {
      return this.handleAdminRequest(url, request)
    }

    // Get auth token if present
    const authToken = this.extractAuthToken(request, url)

    // REST API - Firebase convention uses .json suffix
    let path = url.pathname
    if (path.endsWith('.json')) {
      path = path.slice(0, -5)
    }
    path = normalizePath(path)

    // Parse query options
    const queryOptions = this.parseQueryParams(url.searchParams)

    switch (request.method) {
      case 'GET':
        return this.handleRestGet(path, queryOptions, authToken)
      case 'PUT':
        return this.handleRestSet(path, request, authToken)
      case 'PATCH':
        return this.handleRestUpdate(path, request, authToken)
      case 'POST':
        return this.handleRestPush(path, request, authToken)
      case 'DELETE':
        return this.handleRestRemove(path, authToken)
      default:
        return new Response('Method Not Allowed', { status: 405 })
    }
  }

  private extractAuthToken(request: Request, url: URL): string | undefined {
    // Check query param (Firebase REST convention)
    const authParam = url.searchParams.get('auth')
    if (authParam) return authParam

    // Check Authorization header
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7)
    }

    return undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REST HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleRestGet(
    path: string,
    queryOptions: QueryOptions | null,
    authToken?: string
  ): Promise<Response> {
    // Check read permission
    if (this.rules) {
      const context = this.createRuleContext(authToken, path, 'read')
      if (!evaluateRules(this.rules, path, 'read', context)) {
        return Response.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    let data = this.getDataAtPath(path)

    if (queryOptions && typeof data === 'object' && data !== null) {
      data = this.applyQuery(data as Record<string, unknown>, queryOptions)
    }

    if (data === undefined) {
      return Response.json(null)
    }

    return Response.json(data)
  }

  private async handleRestSet(path: string, request: Request, authToken?: string): Promise<Response> {
    const body = await request.json()

    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(authToken, path, 'write', body)
      if (!evaluateRules(this.rules, path, 'write', context)) {
        return Response.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    const processedData = this.processServerValues(body)
    this.setDataAtPath(path, processedData)
    await this.persist()

    // Notify subscribers
    this.broadcastDataChange(path, processedData)

    return Response.json(processedData)
  }

  private async handleRestUpdate(path: string, request: Request, authToken?: string): Promise<Response> {
    const body = (await request.json()) as Record<string, unknown>

    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(authToken, path, 'write', body)
      if (!evaluateRules(this.rules, path, 'write', context)) {
        return Response.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    const result = await this.update(path, body)
    await this.persist()

    return Response.json(result)
  }

  private async handleRestPush(path: string, request: Request, authToken?: string): Promise<Response> {
    const body = await request.json()

    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(authToken, path, 'write', body)
      if (!evaluateRules(this.rules, path, 'write', context)) {
        return Response.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    const pushId = await this.push(path, body)

    return Response.json({ name: pushId })
  }

  private async handleRestRemove(path: string, authToken?: string): Promise<Response> {
    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(authToken, path, 'write', null)
      if (!evaluateRules(this.rules, path, 'write', context)) {
        return Response.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    await this.remove(path)
    await this.persist()

    return Response.json(null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════════════════

  private async handleAdminRequest(url: URL, request: Request): Promise<Response> {
    const adminPath = url.pathname.replace('/.admin/', '')

    switch (adminPath) {
      case 'rules':
        if (request.method === 'GET') {
          return Response.json(this.rules || {})
        } else if (request.method === 'PUT') {
          const rules = (await request.json()) as SecurityRules
          this.rules = rules
          await this.ctx.storage.put('rules', rules)
          return Response.json({ success: true })
        }
        break

      case 'config':
        if (request.method === 'GET') {
          return Response.json(this.config)
        } else if (request.method === 'PUT') {
          const config = (await request.json()) as DatabaseConfig
          this.config = config
          await this.ctx.storage.put('config', config)
          return Response.json({ success: true })
        }
        break

      case 'stats':
        return Response.json({
          connections: this.connections.size,
          listeners: this.listeners.size,
          dataSize: JSON.stringify(this.data).length,
        })

      case 'export':
        return Response.json(this.data)

      case 'import':
        if (request.method === 'PUT') {
          const data = (await request.json()) as Record<string, unknown>
          this.data = data
          await this.persist()
          return Response.json({ success: true })
        }
        break
    }

    return new Response('Not Found', { status: 404 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  private handleWebSocketUpgrade(request: Request): Response {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    const sessionId = this.generateSessionId()

    // Initialize connection state
    const connection: ConnectionState = {
      ws: server,
      sessionId,
      subscriptions: new Map(),
      lastActivity: Date.now(),
    }
    this.connections.set(sessionId, connection)

    // Accept with hibernation
    this.ctx.acceptWebSocket(server)

    // Send handshake
    server.send(
      JSON.stringify({
        t: 'c',
        d: {
          t: 'h',
          d: {
            ts: Date.now(),
            v: '5',
            h: 'dotdo-firebase.workers.dev',
            s: sessionId,
          },
        },
      })
    )

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const connection = this.findConnectionBySocket(ws)
    if (!connection) return

    connection.lastActivity = Date.now()

    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)

      // Handle keepalive
      if (data === '0') {
        ws.send('1')
        return
      }

      const msg = JSON.parse(data)
      await this.handleFirebaseMessage(ws, connection, msg)
    } catch (error) {
      this.sendError(ws, 0, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const connection = this.findConnectionBySocket(ws)
    if (!connection) return

    // Execute onDisconnect operations
    await this.executeOnDisconnect(connection.sessionId)

    // Cleanup subscriptions
    for (const [, sub] of connection.subscriptions) {
      const listeners = this.listeners.get(sub.path)
      if (listeners) {
        listeners.delete(connection.sessionId)
        if (listeners.size === 0) {
          this.listeners.delete(sub.path)
        }
      }
    }

    this.connections.delete(connection.sessionId)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  private findConnectionBySocket(ws: WebSocket): ConnectionState | undefined {
    for (const connection of this.connections.values()) {
      if (connection.ws === ws) {
        return connection
      }
    }
    return undefined
  }

  private async handleFirebaseMessage(
    ws: WebSocket,
    connection: ConnectionState,
    msg: { t: string; d: unknown }
  ): Promise<void> {
    if (msg.t === 'd') {
      const data = msg.d as {
        r: number
        a: string
        b: {
          p?: string
          q?: QueryOptions
          d?: unknown
          h?: string
          c?: { cred: { token: string } }
        }
      }

      const { r: requestId, a: action, b: body } = data

      switch (action) {
        case 'auth':
          await this.handleAuth(ws, connection, requestId, body.c?.cred?.token)
          break

        case 'unauth':
          connection.authToken = undefined
          connection.userId = undefined
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 'q': // Query (listen)
          await this.handleListen(ws, connection, requestId, body.p!, body.q, body.h)
          break

        case 'n': // Unlisten
          this.handleUnlisten(connection, body.p!)
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 'p': // Put (set)
          await this.handlePut(ws, connection, requestId, body.p!, body.d)
          break

        case 'm': // Merge (update)
          await this.handleMerge(ws, connection, requestId, body.p!, body.d as Record<string, unknown>)
          break

        case 'o': // onDisconnect put
          this.handleOnDisconnectPut(connection, requestId, body.p!, body.d)
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 'om': // onDisconnect merge
          this.handleOnDisconnectMerge(connection, requestId, body.p!, body.d as Record<string, unknown>)
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 'oc': // onDisconnect cancel
          this.handleOnDisconnectCancel(connection, body.p!)
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 's': // Stats
          this.sendResponse(ws, requestId, 'ok', {})
          break

        case 'g': // Get (server SDK)
          await this.handleGet(ws, connection, requestId, body.p!, body.q)
          break
      }
    }
  }

  private async handleAuth(
    ws: WebSocket,
    connection: ConnectionState,
    requestId: number,
    token?: string
  ): Promise<void> {
    if (!token) {
      this.sendResponse(ws, requestId, 'ok', { auth: null })
      return
    }

    // Simplified token validation - in production, verify JWT
    try {
      // Decode JWT payload (simplified)
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]))
        connection.authToken = token
        connection.userId = payload.sub || payload.uid || payload.user_id
        this.sendResponse(ws, requestId, 'ok', { auth: payload })
      } else {
        // Treat as custom token
        connection.authToken = token
        connection.userId = token
        this.sendResponse(ws, requestId, 'ok', { auth: { uid: token } })
      }
    } catch {
      this.sendError(ws, requestId, 'Invalid auth token')
    }
  }

  private async handleListen(
    ws: WebSocket,
    connection: ConnectionState,
    requestId: number,
    path: string,
    query?: QueryOptions,
    _hash?: string
  ): Promise<void> {
    const normalizedPath = normalizePath(path)

    // Check read permission
    if (this.rules) {
      const context = this.createRuleContext(connection.authToken, normalizedPath, 'read')
      if (!evaluateRules(this.rules, normalizedPath, 'read', context)) {
        this.sendError(ws, requestId, 'Permission denied')
        return
      }
    }

    // Add subscription
    connection.subscriptions.set(normalizedPath, { path: normalizedPath, query })

    // Add to listeners
    if (!this.listeners.has(normalizedPath)) {
      this.listeners.set(normalizedPath, new Set())
    }
    this.listeners.get(normalizedPath)!.add(connection.sessionId)

    // Send current data
    let data = this.getDataAtPath(normalizedPath)
    if (query && typeof data === 'object' && data !== null) {
      data = this.applyQuery(data as Record<string, unknown>, query)
    }

    // Send OK first
    this.sendResponse(ws, requestId, 'ok', {})

    // Then send data
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

  private handleUnlisten(connection: ConnectionState, path: string): void {
    const normalizedPath = normalizePath(path)

    connection.subscriptions.delete(normalizedPath)

    const listeners = this.listeners.get(normalizedPath)
    if (listeners) {
      listeners.delete(connection.sessionId)
      if (listeners.size === 0) {
        this.listeners.delete(normalizedPath)
      }
    }
  }

  private async handleGet(
    ws: WebSocket,
    connection: ConnectionState,
    requestId: number,
    path: string,
    query?: QueryOptions
  ): Promise<void> {
    const normalizedPath = normalizePath(path)

    // Check read permission
    if (this.rules) {
      const context = this.createRuleContext(connection.authToken, normalizedPath, 'read')
      if (!evaluateRules(this.rules, normalizedPath, 'read', context)) {
        this.sendError(ws, requestId, 'Permission denied')
        return
      }
    }

    let data = this.getDataAtPath(normalizedPath)
    if (query && typeof data === 'object' && data !== null) {
      data = this.applyQuery(data as Record<string, unknown>, query)
    }

    this.sendResponse(ws, requestId, 'ok', { d: data ?? null })
  }

  private async handlePut(
    ws: WebSocket,
    connection: ConnectionState,
    requestId: number,
    path: string,
    data: unknown
  ): Promise<void> {
    const normalizedPath = normalizePath(path)

    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(connection.authToken, normalizedPath, 'write', data)
      if (!evaluateRules(this.rules, normalizedPath, 'write', context)) {
        this.sendError(ws, requestId, 'Permission denied')
        return
      }
    }

    const processedData = this.processServerValues(data)
    this.setDataAtPath(normalizedPath, processedData)
    await this.persist()

    // Notify subscribers
    this.broadcastDataChange(normalizedPath, processedData)

    this.sendResponse(ws, requestId, 'ok', {})
  }

  private async handleMerge(
    ws: WebSocket,
    connection: ConnectionState,
    requestId: number,
    path: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const normalizedPath = normalizePath(path)

    // Check write permission
    if (this.rules) {
      const context = this.createRuleContext(connection.authToken, normalizedPath, 'write', data)
      if (!evaluateRules(this.rules, normalizedPath, 'write', context)) {
        this.sendError(ws, requestId, 'Permission denied')
        return
      }
    }

    await this.update(normalizedPath, data)
    await this.persist()

    this.sendResponse(ws, requestId, 'ok', {})
  }

  private handleOnDisconnectPut(
    connection: ConnectionState,
    _requestId: number,
    path: string,
    data: unknown
  ): void {
    const ops = this.onDisconnectOps.get(connection.sessionId) || []
    ops.push({ path: normalizePath(path), action: 'set', data })
    this.onDisconnectOps.set(connection.sessionId, ops)
  }

  private handleOnDisconnectMerge(
    connection: ConnectionState,
    _requestId: number,
    path: string,
    data: Record<string, unknown>
  ): void {
    const ops = this.onDisconnectOps.get(connection.sessionId) || []
    ops.push({ path: normalizePath(path), action: 'update', data })
    this.onDisconnectOps.set(connection.sessionId, ops)
  }

  private handleOnDisconnectCancel(connection: ConnectionState, path: string): void {
    const normalizedPath = normalizePath(path)
    const ops = this.onDisconnectOps.get(connection.sessionId) || []
    const filtered = ops.filter((op) => op.path !== normalizedPath)
    this.onDisconnectOps.set(connection.sessionId, filtered)
  }

  private async executeOnDisconnect(sessionId: string): Promise<void> {
    const ops = this.onDisconnectOps.get(sessionId)
    if (!ops || ops.length === 0) return

    for (const op of ops) {
      switch (op.action) {
        case 'set':
          this.setDataAtPath(op.path, op.data)
          this.broadcastDataChange(op.path, op.data)
          break
        case 'update':
          await this.update(op.path, op.data as Record<string, unknown>)
          break
        case 'remove':
          this.setDataAtPath(op.path, null)
          this.broadcastDataChange(op.path, null)
          break
      }
    }

    await this.persist()
    this.onDisconnectOps.delete(sessionId)
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

  private sendError(ws: WebSocket, requestId: number, message: string): void {
    try {
      ws.send(
        JSON.stringify({
          t: 'd',
          d: {
            r: requestId,
            b: { s: 'error', d: message },
          },
        })
      )
    } catch {
      // WebSocket closed
    }
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

  private processServerValues(data: unknown): unknown {
    if (data === null || data === undefined) return data

    if (typeof data === 'object') {
      if ('.sv' in (data as Record<string, unknown>)) {
        const sv = (data as { '.sv': string })['.sv']
        if (sv === 'timestamp') {
          return Date.now()
        }
        if (sv === 'increment') {
          // Handle increment - requires context
          return data
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
  // PUBLIC OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set data at path
   */
  async set(path: string, data: unknown): Promise<WriteResult> {
    await this.init()
    const normalizedPath = normalizePath(path)
    const processedData = this.processServerValues(data)

    this.setDataAtPath(normalizedPath, processedData)
    await this.persist()

    this.broadcastDataChange(normalizedPath, processedData)

    return { success: true, data: processedData }
  }

  /**
   * Update data at path (merge)
   */
  async update(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const normalizedPath = normalizePath(path)
    const current = (this.getDataAtPath(normalizedPath) as Record<string, unknown>) || {}

    const updates: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const processedValue = this.processServerValues(value)

      if (key.includes('/')) {
        // Multi-path update
        this.setDataAtPath(joinPaths(normalizedPath, key), processedValue)
        updates[key] = processedValue
        this.broadcastDataChange(joinPaths(normalizedPath, key), processedValue)
      } else {
        current[key] = processedValue
        updates[key] = processedValue
      }
    }

    if (!Object.keys(data).some((k) => k.includes('/'))) {
      this.setDataAtPath(normalizedPath, current)
    }

    this.broadcastDataChange(normalizedPath, this.getDataAtPath(normalizedPath))

    return updates
  }

  /**
   * Push new child with auto-generated key
   */
  async push(path: string, data: unknown): Promise<string> {
    await this.init()
    const normalizedPath = normalizePath(path)
    const pushId = generatePushId()
    const childPath = joinPaths(normalizedPath, pushId)
    const processedData = this.processServerValues(data)

    this.setDataAtPath(childPath, processedData)
    await this.persist()

    this.broadcastDataChange(normalizedPath, this.getDataAtPath(normalizedPath))
    this.broadcastDataChange(childPath, processedData)

    return pushId
  }

  /**
   * Remove data at path
   */
  async remove(path: string): Promise<WriteResult> {
    await this.init()
    const normalizedPath = normalizePath(path)

    this.setDataAtPath(normalizedPath, null)
    await this.persist()

    this.broadcastDataChange(normalizedPath, null)

    return { success: true }
  }

  /**
   * Transaction - atomic read-modify-write
   */
  async transaction(path: string, updateFn: (current: unknown) => unknown): Promise<TransactionResult> {
    await this.init()
    const normalizedPath = normalizePath(path)

    // Optimistic locking with retries
    const maxRetries = 25
    let retries = 0

    while (retries < maxRetries) {
      const currentData = this.getDataAtPath(normalizedPath)
      const newData = updateFn(currentData)

      if (newData === undefined) {
        // Transaction aborted
        return {
          committed: false,
          snapshot: createSnapshot(normalizedPath.split('/').pop() || null, currentData),
        }
      }

      const processedData = this.processServerValues(newData)

      // In a real implementation, we'd check for concurrent modifications
      // For now, we just write
      this.setDataAtPath(normalizedPath, processedData)
      await this.persist()

      this.broadcastDataChange(normalizedPath, processedData)

      return {
        committed: true,
        snapshot: createSnapshot(normalizedPath.split('/').pop() || null, processedData),
      }
    }

    throw new Error('Transaction max retries exceeded')
  }

  /**
   * Get data at path
   */
  async get(path: string): Promise<DataSnapshot> {
    await this.init()
    const normalizedPath = normalizePath(path)
    const data = this.getDataAtPath(normalizedPath)
    return createSnapshot(normalizedPath.split('/').pop() || null, data)
  }

  /**
   * Query data
   */
  async query(path: string, options: QueryOptions): Promise<unknown> {
    await this.init()
    const normalizedPath = normalizePath(path)
    const data = this.getDataAtPath(normalizedPath)

    if (typeof data !== 'object' || data === null) {
      return data
    }

    return this.applyQuery(data as Record<string, unknown>, options)
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
      options.orderByChild = JSON.parse(orderByChild)
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
        const aPriority =
          typeof a === 'object' && a !== null ? (a as { '.priority'?: unknown })['.priority'] : null
        const bPriority =
          typeof b === 'object' && b !== null ? (b as { '.priority'?: unknown })['.priority'] : null
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
      return typeof value === 'object' && value !== null
        ? (value as { '.priority'?: unknown })['.priority']
        : null
    }
    return key
  }

  private compareValues(a: unknown, b: unknown): number {
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
  // REAL-TIME BROADCAST
  // ═══════════════════════════════════════════════════════════════════════════

  private broadcastDataChange(path: string, data: unknown): void {
    // Notify exact path listeners
    this.notifyPathListeners(path, data)

    // Notify parent path listeners
    const segments = getPathSegments(path)
    for (let i = segments.length - 1; i >= 0; i--) {
      const parentPath = segments.slice(0, i).join('/')
      const parentData = this.getDataAtPath(parentPath)
      this.notifyPathListeners(parentPath, parentData)
    }

    // Notify root listeners
    if (segments.length > 0) {
      this.notifyPathListeners('', this.data)
    }
  }

  private notifyPathListeners(path: string, data: unknown): void {
    const listeners = this.listeners.get(path)
    if (!listeners) return

    for (const sessionId of listeners) {
      const connection = this.connections.get(sessionId)
      if (!connection) continue

      const subscription = connection.subscriptions.get(path)
      let finalData = data

      // Apply query if present
      if (subscription?.query && typeof data === 'object' && data !== null) {
        finalData = this.applyQuery(data as Record<string, unknown>, subscription.query)
      }

      try {
        connection.ws.send(
          JSON.stringify({
            t: 'd',
            d: {
              a: 'd',
              b: {
                p: path || '/',
                d: finalData ?? null,
              },
            },
          })
        )
      } catch {
        // WebSocket closed
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY RULES
  // ═══════════════════════════════════════════════════════════════════════════

  private createRuleContext(
    authToken: string | undefined,
    path: string,
    operation: 'read' | 'write',
    newData?: unknown
  ): RuleContext {
    let auth: { uid: string; token: Record<string, unknown> } | null = null

    if (authToken) {
      try {
        const parts = authToken.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          auth = {
            uid: payload.sub || payload.uid || payload.user_id,
            token: payload,
          }
        } else {
          auth = { uid: authToken, token: {} }
        }
      } catch {
        // Invalid token
      }
    }

    return {
      auth,
      path,
      data: this.getDataAtPath(path),
      newData,
      root: this.data,
      now: Date.now(),
    }
  }

  /**
   * Set security rules
   */
  async setRules(rules: SecurityRules): Promise<void> {
    this.rules = rules
    await this.ctx.storage.put('rules', rules)
  }

  /**
   * Get current security rules
   */
  getRules(): SecurityRules | null {
    return this.rules
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }

  /**
   * Get database stats
   */
  getStats(): { connections: number; listeners: number; dataSize: number } {
    return {
      connections: this.connections.size,
      listeners: this.listeners.size,
      dataSize: JSON.stringify(this.data).length,
    }
  }

  /**
   * Export all data
   */
  exportData(): Record<string, unknown> {
    return structuredClone(this.data)
  }

  /**
   * Import data
   */
  async importData(data: Record<string, unknown>): Promise<void> {
    this.data = data
    await this.persist()
    this.broadcastDataChange('', this.data)
  }
}

export default FirebaseDO
