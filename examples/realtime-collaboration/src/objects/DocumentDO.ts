/**
 * DocumentDO - Collaborative Document Durable Object
 *
 * Provides real-time collaborative document editing with:
 * - CRDT-based text editing (conflict-free)
 * - Operational transformation fallback
 * - Cursor/selection synchronization
 * - Undo/redo with collaboration awareness
 * - Version history
 * - WebSocket hibernation for efficient connections
 */

import { DurableObject } from 'cloudflare:workers'
import { YDoc } from '../crdt/doc'
import { LamportClock } from '../crdt/clock'
import type {
  Message,
  SyncRequestMessage,
  SyncUpdateMessage,
  CursorUpdateMessage,
  CursorPosition,
  ConnectMessage,
  PresenceUser,
} from '../protocol/messages'
import { encodeMessage, decodeMessage } from '../protocol/encoder'
import { createErrorMessage } from '../protocol/messages'
import type { Operation } from '../crdt/operations'

// ============================================================================
// Types
// ============================================================================

interface Env {
  ENVIRONMENT?: string
}

interface DocumentVersion {
  version: number
  timestamp: number
  clientId: string
  operationCount: number
}

interface WebSocketState {
  clientId: string
  userId?: string
  cursor?: CursorPosition
  user?: PresenceUser
}

// ============================================================================
// DocumentDO Class
// ============================================================================

export class DocumentDO extends DurableObject<Env> {
  private doc: YDoc | null = null
  private documentId: string = ''
  private clients: Map<WebSocket, WebSocketState> = new Map()
  private versionHistory: DocumentVersion[] = []
  private pendingOperations: Map<string, Operation[]> = new Map()
  private maxHistoryLength = 100

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize document from storage
   */
  private async initDocument(): Promise<void> {
    if (this.doc) return

    // Load from storage
    const stored = await this.ctx.storage.get<string>('document')
    if (stored) {
      try {
        const state = JSON.parse(stored)
        this.doc = YDoc.fromJSON(state)
      } catch {
        this.doc = new YDoc()
      }
    } else {
      this.doc = new YDoc()
    }

    // Load version history
    const history = await this.ctx.storage.get<DocumentVersion[]>('history')
    if (history) {
      this.versionHistory = history
    }

    // Load document ID
    const docId = await this.ctx.storage.get<string>('documentId')
    if (docId) {
      this.documentId = docId
    }
  }

  /**
   * Save document to storage
   */
  private async saveDocument(): Promise<void> {
    if (!this.doc) return

    await this.ctx.storage.put('document', JSON.stringify(this.doc.toJSON()))
    await this.ctx.storage.put('history', this.versionHistory)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract document ID from path
    const pathParts = url.pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      this.documentId = pathParts[0]
      await this.ctx.storage.put('documentId', this.documentId)
    }

    await this.initDocument()

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request)
    }

    // REST API
    switch (url.pathname.split('/').pop()) {
      case 'content':
        return this.handleGetContent()
      case 'state':
        return this.handleGetState()
      case 'history':
        return this.handleGetHistory()
      case 'update':
        return this.handleUpdate(request)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  /**
   * Get document content as plain text
   */
  private handleGetContent(): Response {
    if (!this.doc) {
      return Response.json({ error: 'Document not initialized' }, { status: 500 })
    }

    const text = this.doc.getText()
    return Response.json({
      documentId: this.documentId,
      content: text.toString(),
      length: text.length,
      version: this.doc.getVersion(),
    })
  }

  /**
   * Get full document state for debugging
   */
  private handleGetState(): Response {
    if (!this.doc) {
      return Response.json({ error: 'Document not initialized' }, { status: 500 })
    }

    return Response.json({
      documentId: this.documentId,
      state: this.doc.toJSON(),
      connectedClients: this.clients.size,
    })
  }

  /**
   * Get version history
   */
  private handleGetHistory(): Response {
    return Response.json({
      documentId: this.documentId,
      history: this.versionHistory,
    })
  }

  /**
   * Handle HTTP update (for non-WebSocket clients)
   */
  private async handleUpdate(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    if (!this.doc) {
      return Response.json({ error: 'Document not initialized' }, { status: 500 })
    }

    const body = (await request.json()) as { operations: Operation[]; clientId: string }

    // Apply operations
    this.doc.applyOperations(body.operations, body.clientId)

    // Save
    await this.saveDocument()

    // Broadcast to WebSocket clients
    this.broadcastOperations(body.operations, body.clientId)

    return Response.json({
      version: this.doc.getVersion(),
      success: true,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WEBSOCKET HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Upgrade to WebSocket connection
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    // Accept with hibernation
    this.ctx.acceptWebSocket(server)

    // Initialize state (will be updated on connect message)
    this.clients.set(server, {
      clientId: crypto.randomUUID(),
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  /**
   * Handle WebSocket message (hibernation-compatible)
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
   * Route message to appropriate handler
   */
  private async handleMessage(ws: WebSocket, msg: Message): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.handleConnect(ws, msg as ConnectMessage)
        break
      case 'sync:request':
        await this.handleSyncRequest(ws, msg as SyncRequestMessage)
        break
      case 'sync:update':
        await this.handleSyncUpdate(ws, msg as SyncUpdateMessage)
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
    const state = this.clients.get(ws)
    if (!state) return

    // Update client state
    state.clientId = msg.clientId
    state.userId = msg.auth?.userId

    // Send connected message
    ws.send(
      encodeMessage({
        type: 'connected',
        clientId: msg.clientId,
        sessionId: crypto.randomUUID(),
        serverTime: Date.now(),
      })
    )

    // Send initial sync
    await this.sendFullSync(ws)

    // Broadcast presence to other clients
    this.broadcastPresenceJoin(state)
  }

  /**
   * Handle sync request from client
   */
  private async handleSyncRequest(ws: WebSocket, msg: SyncRequestMessage): Promise<void> {
    if (!this.doc) return

    // Send full state
    await this.sendFullSync(ws)
  }

  /**
   * Send full document state to client
   */
  private async sendFullSync(ws: WebSocket): Promise<void> {
    if (!this.doc) return

    const state = this.doc.encodeState()
    const base64State = btoa(String.fromCharCode(...state))

    ws.send(
      encodeMessage({
        type: 'sync:response',
        documentId: this.documentId,
        state: base64State,
        version: this.doc.getVersion(),
        stateVector: this.doc.vectorClock.toJSON(),
      })
    )

    // Also send current cursors
    const cursors: CursorPosition[] = []
    for (const [, clientState] of this.clients) {
      if (clientState.cursor) {
        cursors.push(clientState.cursor)
      }
    }

    if (cursors.length > 0) {
      ws.send(
        encodeMessage({
          type: 'cursor:sync',
          documentId: this.documentId,
          cursors,
        })
      )
    }
  }

  /**
   * Handle sync update from client
   */
  private async handleSyncUpdate(ws: WebSocket, msg: SyncUpdateMessage): Promise<void> {
    if (!this.doc) return

    const state = this.clients.get(ws)
    const clientId = state?.clientId ?? 'unknown'

    // Apply operations
    this.doc.applyOperations(msg.operations, clientId)

    // Record in history
    this.recordVersion(clientId, msg.operations.length)

    // Save document
    await this.saveDocument()

    // Send ack
    ws.send(
      encodeMessage({
        type: 'sync:ack',
        documentId: this.documentId,
        version: this.doc.getVersion(),
        receivedOperations: msg.operations.length,
      })
    )

    // Broadcast to other clients
    this.broadcastOperations(msg.operations, clientId, ws)
  }

  /**
   * Handle cursor update
   */
  private async handleCursorUpdate(ws: WebSocket, msg: CursorUpdateMessage): Promise<void> {
    const state = this.clients.get(ws)
    if (!state) return

    // Update local cursor state
    state.cursor = msg.cursor

    // Broadcast to other clients
    for (const [clientWs, clientState] of this.clients) {
      if (clientWs !== ws) {
        try {
          clientWs.send(encodeMessage(msg))
        } catch {
          // Client disconnected
        }
      }
    }
  }

  /**
   * Handle WebSocket close
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const state = this.clients.get(ws)
    if (state) {
      // Broadcast leave to other clients
      this.broadcastPresenceLeave(state)
    }
    this.clients.delete(ws)
  }

  /**
   * Handle WebSocket error
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const state = this.clients.get(ws)
    if (state) {
      this.broadcastPresenceLeave(state)
    }
    this.clients.delete(ws)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROADCASTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Broadcast operations to all clients except sender
   */
  private broadcastOperations(operations: Operation[], origin: string, exclude?: WebSocket): void {
    if (!this.doc) return

    const msg = encodeMessage({
      type: 'sync:update',
      documentId: this.documentId,
      operations,
      origin,
      version: this.doc.getVersion(),
    })

    for (const [ws] of this.clients) {
      if (ws !== exclude) {
        try {
          ws.send(msg)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  /**
   * Broadcast presence join
   */
  private broadcastPresenceJoin(state: WebSocketState): void {
    const user: PresenceUser = {
      clientId: state.clientId,
      userId: state.userId,
      status: 'online',
      lastSeen: Date.now(),
    }

    const msg = encodeMessage({
      type: 'presence:join',
      user,
      roomId: this.documentId,
    })

    for (const [ws, clientState] of this.clients) {
      if (clientState.clientId !== state.clientId) {
        try {
          ws.send(msg)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  /**
   * Broadcast presence leave
   */
  private broadcastPresenceLeave(state: WebSocketState): void {
    const msg = encodeMessage({
      type: 'presence:leave',
      clientId: state.clientId,
      roomId: this.documentId,
    })

    for (const [ws, clientState] of this.clients) {
      if (clientState.clientId !== state.clientId) {
        try {
          ws.send(msg)
        } catch {
          // Client disconnected
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION HISTORY
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Record a new version in history
   */
  private recordVersion(clientId: string, operationCount: number): void {
    const version: DocumentVersion = {
      version: this.doc?.getVersion() ?? 0,
      timestamp: Date.now(),
      clientId,
      operationCount,
    }

    this.versionHistory.push(version)

    // Trim history if too long
    if (this.versionHistory.length > this.maxHistoryLength) {
      this.versionHistory = this.versionHistory.slice(-this.maxHistoryLength)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RPC METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Insert text at position
   */
  async insertText(index: number, content: string, clientId: string): Promise<{ version: number; operations: Operation[] }> {
    await this.initDocument()
    if (!this.doc) throw new Error('Document not initialized')

    const text = this.doc.getText()
    const clock = new LamportClock(clientId)
    const operations = text.insert(clock, index, content)

    await this.saveDocument()
    this.broadcastOperations(operations, clientId)

    return {
      version: this.doc.getVersion(),
      operations,
    }
  }

  /**
   * Delete text at position
   */
  async deleteText(index: number, length: number, clientId: string): Promise<{ version: number; operations: Operation[] }> {
    await this.initDocument()
    if (!this.doc) throw new Error('Document not initialized')

    const text = this.doc.getText()
    const clock = new LamportClock(clientId)
    const operations = text.delete(clock, index, length)

    await this.saveDocument()
    this.broadcastOperations(operations, clientId)

    return {
      version: this.doc.getVersion(),
      operations,
    }
  }

  /**
   * Get document content
   */
  async getContent(): Promise<string> {
    await this.initDocument()
    if (!this.doc) throw new Error('Document not initialized')

    return this.doc.getText().toString()
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Get document info
   */
  async getInfo(): Promise<{ documentId: string; version: number; length: number; clients: number }> {
    await this.initDocument()

    return {
      documentId: this.documentId,
      version: this.doc?.getVersion() ?? 0,
      length: this.doc?.getText().length ?? 0,
      clients: this.clients.size,
    }
  }

  /**
   * Undo last operation for a client
   */
  async undo(clientId: string): Promise<boolean> {
    await this.initDocument()
    if (!this.doc) return false

    const success = this.doc.undo()
    if (success) {
      await this.saveDocument()
    }
    return success
  }

  /**
   * Redo last undone operation for a client
   */
  async redo(clientId: string): Promise<boolean> {
    await this.initDocument()
    if (!this.doc) return false

    const success = this.doc.redo()
    if (success) {
      await this.saveDocument()
    }
    return success
  }
}
