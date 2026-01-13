/**
 * WhiteboardDO - Visual Collaboration Durable Object
 *
 * Provides real-time visual collaboration with:
 * - Shape drawing and manipulation
 * - Multi-user cursors
 * - Sticky notes
 * - Element locking/unlocking
 * - Z-index management
 * - WebSocket hibernation
 */

import { DurableObject } from 'cloudflare:workers'
import type {
  Message,
  Shape,
  WhiteboardDrawMessage,
  WhiteboardUpdateMessage,
  WhiteboardDeleteMessage,
  WhiteboardLockMessage,
  WhiteboardUnlockMessage,
  CursorPosition,
  CursorUpdateMessage,
  ConnectMessage,
} from '../protocol/messages'
import { encodeMessage, decodeMessage } from '../protocol/encoder'
import { createErrorMessage, createWhiteboardDrawMessage } from '../protocol/messages'

// ============================================================================
// Types
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

interface ClientState {
  clientId: string
  userId?: string
  name?: string
  color?: string
  ws: WebSocket
  cursor?: { x: number; y: number }
  lastActivity: number
}

// ============================================================================
// WhiteboardDO Class
// ============================================================================

export class WhiteboardDO extends DurableObject<Env> {
  private boardId: string = ''
  private shapes: Map<string, Shape> = new Map()
  private clients: Map<string, ClientState> = new Map()
  private shapeCounter: number = 0
  private maxZIndex: number = 0

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load whiteboard state from storage
   */
  private async loadState(): Promise<void> {
    const shapes = await this.ctx.storage.get<Map<string, Shape>>('shapes')
    if (shapes) {
      this.shapes = new Map(Object.entries(shapes))
    }

    const counter = await this.ctx.storage.get<number>('shapeCounter')
    if (counter !== undefined) {
      this.shapeCounter = counter
    }

    const maxZ = await this.ctx.storage.get<number>('maxZIndex')
    if (maxZ !== undefined) {
      this.maxZIndex = maxZ
    }

    const boardId = await this.ctx.storage.get<string>('boardId')
    if (boardId) {
      this.boardId = boardId
    }
  }

  /**
   * Save whiteboard state to storage
   */
  private async saveState(): Promise<void> {
    await this.ctx.storage.put('shapes', Object.fromEntries(this.shapes))
    await this.ctx.storage.put('shapeCounter', this.shapeCounter)
    await this.ctx.storage.put('maxZIndex', this.maxZIndex)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    await this.loadState()

    // Extract board ID from path
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      this.boardId = pathParts[0]
      await this.ctx.storage.put('boardId', this.boardId)
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API
    const endpoint = url.pathname.split('/').pop()
    switch (endpoint) {
      case 'shapes':
        return this.handleGetShapes()
      case 'draw':
        return this.handleDrawShape(request)
      case 'update':
        return this.handleUpdateShape(request)
      case 'delete':
        return this.handleDeleteShapes(request)
      case 'clear':
        return this.handleClearBoard()
      case 'export':
        return this.handleExport()
      case 'import':
        return this.handleImport(request)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Get all shapes
   */
  private handleGetShapes(): Response {
    const shapes = Array.from(this.shapes.values()).sort((a, b) => a.zIndex - b.zIndex)

    return Response.json({
      boardId: this.boardId,
      shapes,
      count: shapes.length,
    })
  }

  /**
   * Draw a new shape via HTTP
   */
  private async handleDrawShape(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = (await request.json()) as Omit<Shape, 'id' | 'createdAt' | 'updatedAt' | 'zIndex'>

    const shape = this.createShape(body)
    await this.saveState()

    // Broadcast to WebSocket clients
    this.broadcastAll(encodeMessage(createWhiteboardDrawMessage(this.boardId, shape)))

    return Response.json({ shape })
  }

  /**
   * Update a shape via HTTP
   */
  private async handleUpdateShape(request: Request): Promise<Response> {
    if (request.method !== 'POST' && request.method !== 'PATCH') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = (await request.json()) as { shapeId: string; updates: Partial<Shape> }

    const shape = this.shapes.get(body.shapeId)
    if (!shape) {
      return Response.json({ error: 'Shape not found' }, { status: 404 })
    }

    // Check lock
    if (shape.locked && shape.lockedBy !== body.updates.createdBy) {
      return Response.json({ error: 'Shape is locked' }, { status: 403 })
    }

    // Apply updates
    Object.assign(shape, body.updates, { updatedAt: Date.now() })
    await this.saveState()

    // Broadcast update
    this.broadcastAll(
      encodeMessage({
        type: 'whiteboard:update',
        boardId: this.boardId,
        shapeId: body.shapeId,
        updates: body.updates,
      })
    )

    return Response.json({ shape })
  }

  /**
   * Delete shapes via HTTP
   */
  private async handleDeleteShapes(request: Request): Promise<Response> {
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const body = (await request.json()) as { shapeIds: string[] }

    const deleted: string[] = []
    for (const id of body.shapeIds) {
      if (this.shapes.delete(id)) {
        deleted.push(id)
      }
    }

    await this.saveState()

    // Broadcast deletion
    if (deleted.length > 0) {
      this.broadcastAll(
        encodeMessage({
          type: 'whiteboard:delete',
          boardId: this.boardId,
          shapeIds: deleted,
        })
      )
    }

    return Response.json({ deleted })
  }

  /**
   * Clear all shapes
   */
  private async handleClearBoard(): Promise<Response> {
    const shapeIds = Array.from(this.shapes.keys())
    this.shapes.clear()
    this.shapeCounter = 0
    this.maxZIndex = 0

    await this.saveState()

    // Broadcast deletion
    if (shapeIds.length > 0) {
      this.broadcastAll(
        encodeMessage({
          type: 'whiteboard:delete',
          boardId: this.boardId,
          shapeIds,
        })
      )
    }

    return Response.json({ cleared: true, count: shapeIds.length })
  }

  /**
   * Export whiteboard to JSON
   */
  private handleExport(): Response {
    const data = {
      boardId: this.boardId,
      shapes: Array.from(this.shapes.values()),
      exportedAt: Date.now(),
    }

    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${this.boardId}.json"`,
      },
    })
  }

  /**
   * Import whiteboard from JSON
   */
  private async handleImport(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const data = (await request.json()) as { shapes: Shape[] }

    // Clear existing shapes
    this.shapes.clear()
    this.maxZIndex = 0

    // Import new shapes
    for (const shape of data.shapes) {
      this.shapes.set(shape.id, shape)
      if (shape.zIndex > this.maxZIndex) {
        this.maxZIndex = shape.zIndex
      }
    }

    this.shapeCounter = data.shapes.length

    await this.saveState()

    // Broadcast sync to all clients
    this.broadcastSync()

    return Response.json({ imported: data.shapes.length })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Upgrade to WebSocket
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    this.ctx.acceptWebSocket(server)

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle WebSocket message
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
      const msg = decodeMessage(data)

      await this.handleMessage(ws, msg)
    } catch (error) {
      const errorMsg = createErrorMessage('PARSE_ERROR', error instanceof Error ? error.message : 'Unknown error')
      ws.send(encodeMessage(errorMsg))
    }
  }

  /**
   * Route message to handler
   */
  private async handleMessage(ws: WebSocket, msg: Message): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.handleConnect(ws, msg as ConnectMessage)
        break
      case 'whiteboard:draw':
        await this.handleDraw(ws, msg as WhiteboardDrawMessage)
        break
      case 'whiteboard:update':
        await this.handleUpdate(ws, msg as WhiteboardUpdateMessage)
        break
      case 'whiteboard:delete':
        await this.handleDelete(ws, msg as WhiteboardDeleteMessage)
        break
      case 'whiteboard:lock':
        await this.handleLock(ws, msg as WhiteboardLockMessage)
        break
      case 'whiteboard:unlock':
        await this.handleUnlock(ws, msg as WhiteboardUnlockMessage)
        break
      case 'cursor:update':
        await this.handleCursorUpdate(ws, msg as CursorUpdateMessage)
        break
      case 'ping':
        ws.send(encodeMessage({ type: 'pong', serverTime: Date.now() }))
        break
    }
  }

  /**
   * Handle client connection
   */
  private async handleConnect(ws: WebSocket, msg: ConnectMessage): Promise<void> {
    const clientId = msg.clientId

    // Generate a random color for this user
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
    const color = colors[Math.floor(Math.random() * colors.length)]

    const state: ClientState = {
      clientId,
      userId: msg.auth?.userId,
      color,
      ws,
      lastActivity: Date.now(),
    }

    this.clients.set(clientId, state)

    // Send connected message
    ws.send(
      encodeMessage({
        type: 'connected',
        clientId,
        sessionId: crypto.randomUUID(),
        serverTime: Date.now(),
      })
    )

    // Send full sync
    this.sendSync(ws)

    // Broadcast presence to others
    this.broadcastExcept(
      clientId,
      encodeMessage({
        type: 'presence:join',
        user: {
          clientId,
          userId: msg.auth?.userId,
          color,
          status: 'online',
          lastSeen: Date.now(),
        },
        roomId: this.boardId,
      })
    )
  }

  /**
   * Handle draw message
   */
  private async handleDraw(ws: WebSocket, msg: WhiteboardDrawMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    // Create shape with server-assigned ID and zIndex
    const shape = this.createShape({
      ...msg.shape,
      createdBy: state.clientId,
    })

    await this.saveState()

    // Broadcast to all (including sender for ID confirmation)
    this.broadcastAll(encodeMessage(createWhiteboardDrawMessage(this.boardId, shape)))
  }

  /**
   * Handle update message
   */
  private async handleUpdate(ws: WebSocket, msg: WhiteboardUpdateMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    const shape = this.shapes.get(msg.shapeId)
    if (!shape) return

    // Check lock
    if (shape.locked && shape.lockedBy !== state.clientId) {
      ws.send(encodeMessage(createErrorMessage('LOCKED', 'Shape is locked by another user')))
      return
    }

    // Apply updates
    Object.assign(shape, msg.updates, { updatedAt: Date.now() })
    await this.saveState()

    // Broadcast to others
    this.broadcastExcept(state.clientId, encodeMessage(msg))
  }

  /**
   * Handle delete message
   */
  private async handleDelete(ws: WebSocket, msg: WhiteboardDeleteMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    const deleted: string[] = []

    for (const id of msg.shapeIds) {
      const shape = this.shapes.get(id)
      if (!shape) continue

      // Check lock
      if (shape.locked && shape.lockedBy !== state.clientId) {
        continue // Skip locked shapes
      }

      this.shapes.delete(id)
      deleted.push(id)
    }

    if (deleted.length > 0) {
      await this.saveState()

      // Broadcast to others
      this.broadcastExcept(
        state.clientId,
        encodeMessage({
          type: 'whiteboard:delete',
          boardId: this.boardId,
          shapeIds: deleted,
        })
      )
    }
  }

  /**
   * Handle lock message
   */
  private async handleLock(ws: WebSocket, msg: WhiteboardLockMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    const shape = this.shapes.get(msg.shapeId)
    if (!shape) return

    // Check if already locked by someone else
    if (shape.locked && shape.lockedBy !== state.clientId) {
      ws.send(encodeMessage(createErrorMessage('LOCKED', 'Shape is already locked')))
      return
    }

    // Lock the shape
    shape.locked = true
    shape.lockedBy = state.clientId
    shape.updatedAt = Date.now()

    await this.saveState()

    // Broadcast to all
    this.broadcastAll(encodeMessage(msg))
  }

  /**
   * Handle unlock message
   */
  private async handleUnlock(ws: WebSocket, msg: WhiteboardUnlockMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    const shape = this.shapes.get(msg.shapeId)
    if (!shape) return

    // Only owner can unlock
    if (shape.lockedBy !== state.clientId) {
      ws.send(encodeMessage(createErrorMessage('NOT_OWNER', 'Only the lock owner can unlock')))
      return
    }

    // Unlock the shape
    shape.locked = false
    shape.lockedBy = undefined
    shape.updatedAt = Date.now()

    await this.saveState()

    // Broadcast to all
    this.broadcastAll(encodeMessage(msg))
  }

  /**
   * Handle cursor update
   */
  private async handleCursorUpdate(ws: WebSocket, msg: CursorUpdateMessage): Promise<void> {
    const state = this.findClientByWs(ws)
    if (!state) return

    // Update local cursor state
    if (msg.cursor.x !== undefined && msg.cursor.y !== undefined) {
      state.cursor = { x: msg.cursor.x, y: msg.cursor.y }
    }
    state.lastActivity = Date.now()

    // Broadcast to others
    this.broadcastExcept(state.clientId, encodeMessage(msg))
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const state = this.findClientByWs(ws)
    if (state) {
      // Unlock all shapes locked by this user
      for (const shape of this.shapes.values()) {
        if (shape.lockedBy === state.clientId) {
          shape.locked = false
          shape.lockedBy = undefined
        }
      }

      this.clients.delete(state.clientId)

      // Broadcast leave
      this.broadcastAll(
        encodeMessage({
          type: 'presence:leave',
          clientId: state.clientId,
          roomId: this.boardId,
        })
      )
    }
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const state = this.findClientByWs(ws)
    if (state) {
      for (const shape of this.shapes.values()) {
        if (shape.lockedBy === state.clientId) {
          shape.locked = false
          shape.lockedBy = undefined
        }
      }

      this.clients.delete(state.clientId)

      this.broadcastAll(
        encodeMessage({
          type: 'presence:leave',
          clientId: state.clientId,
          roomId: this.boardId,
        })
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHAPE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new shape
   */
  private createShape(data: Omit<Shape, 'id' | 'createdAt' | 'updatedAt' | 'zIndex'> & Partial<Pick<Shape, 'id' | 'zIndex'>>): Shape {
    this.shapeCounter++
    this.maxZIndex++

    const shape: Shape = {
      ...data,
      id: data.id ?? `shape_${Date.now()}_${this.shapeCounter}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      zIndex: data.zIndex ?? this.maxZIndex,
    }

    this.shapes.set(shape.id, shape)
    return shape
  }

  /**
   * Send full sync to a client
   */
  private sendSync(ws: WebSocket): void {
    const shapes = Array.from(this.shapes.values()).sort((a, b) => a.zIndex - b.zIndex)

    const cursors: CursorPosition[] = []
    for (const state of this.clients.values()) {
      if (state.cursor) {
        cursors.push({
          clientId: state.clientId,
          documentId: this.boardId,
          x: state.cursor.x,
          y: state.cursor.y,
          color: state.color,
          name: state.name,
        })
      }
    }

    ws.send(
      encodeMessage({
        type: 'whiteboard:sync',
        boardId: this.boardId,
        shapes,
        cursors,
      })
    )
  }

  /**
   * Broadcast sync to all clients
   */
  private broadcastSync(): void {
    for (const state of this.clients.values()) {
      this.sendSync(state.ws)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find client state by WebSocket
   */
  private findClientByWs(ws: WebSocket): ClientState | undefined {
    for (const state of this.clients.values()) {
      if (state.ws === ws) {
        return state
      }
    }
    return undefined
  }

  /**
   * Broadcast to all clients
   */
  private broadcastAll(message: string): void {
    for (const state of this.clients.values()) {
      try {
        state.ws.send(message)
      } catch {
        // Client disconnected
      }
    }
  }

  /**
   * Broadcast to all except one client
   */
  private broadcastExcept(excludeClientId: string, message: string): void {
    for (const [clientId, state] of this.clients) {
      if (clientId !== excludeClientId) {
        try {
          state.ws.send(message)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all shapes
   */
  async getShapes(): Promise<Shape[]> {
    await this.loadState()
    return Array.from(this.shapes.values()).sort((a, b) => a.zIndex - b.zIndex)
  }

  /**
   * Get shape by ID
   */
  async getShape(id: string): Promise<Shape | undefined> {
    await this.loadState()
    return this.shapes.get(id)
  }

  /**
   * Get shape count
   */
  async getShapeCount(): Promise<number> {
    await this.loadState()
    return this.shapes.size
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Bring shape to front
   */
  async bringToFront(shapeId: string): Promise<boolean> {
    await this.loadState()

    const shape = this.shapes.get(shapeId)
    if (!shape) return false

    this.maxZIndex++
    shape.zIndex = this.maxZIndex
    shape.updatedAt = Date.now()

    await this.saveState()

    this.broadcastAll(
      encodeMessage({
        type: 'whiteboard:update',
        boardId: this.boardId,
        shapeId,
        updates: { zIndex: shape.zIndex },
      })
    )

    return true
  }

  /**
   * Send shape to back
   */
  async sendToBack(shapeId: string): Promise<boolean> {
    await this.loadState()

    const shape = this.shapes.get(shapeId)
    if (!shape) return false

    // Find minimum zIndex
    let minZ = Infinity
    for (const s of this.shapes.values()) {
      if (s.zIndex < minZ) minZ = s.zIndex
    }

    shape.zIndex = minZ - 1
    shape.updatedAt = Date.now()

    await this.saveState()

    this.broadcastAll(
      encodeMessage({
        type: 'whiteboard:update',
        boardId: this.boardId,
        shapeId,
        updates: { zIndex: shape.zIndex },
      })
    )

    return true
  }
}
