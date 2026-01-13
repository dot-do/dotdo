/**
 * Client-side Sync Library
 *
 * Provides client-side utilities for real-time collaboration:
 * - WebSocket connection management with auto-reconnect
 * - Optimistic updates with conflict resolution
 * - Offline support with operation queuing
 * - Event-based API for UI integration
 */

import { YDoc } from './crdt/doc'
import type { Operation } from './crdt/operations'
import type {
  Message,
  PresenceUser,
  CursorPosition,
  ChannelMessage,
  Shape,
} from './protocol/messages'
import { encodeMessage, decodeMessage } from './protocol/encoder'
import { TIMEOUTS, CONNECTION_STATE } from './protocol/constants'

// ============================================================================
// Types
// ============================================================================

export type ConnectionState = (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE]

export interface CollaborationClientOptions {
  url: string
  documentId?: string
  channelId?: string
  clientId?: string
  userId?: string
  userName?: string
  userColor?: string
  auth?: { token: string }
  autoReconnect?: boolean
  heartbeatInterval?: number
}

export interface ClientEvents {
  connect: () => void
  disconnect: (reason?: string) => void
  error: (error: Error) => void
  reconnecting: (attempt: number) => void

  // Document events
  'sync:update': (operations: Operation[], origin: string) => void
  'sync:synced': () => void

  // Presence events
  'presence:join': (user: PresenceUser) => void
  'presence:leave': (clientId: string) => void
  'presence:update': (clientId: string, updates: Partial<PresenceUser>) => void
  'presence:sync': (users: PresenceUser[]) => void

  // Cursor events
  'cursor:update': (cursor: CursorPosition) => void
  'cursor:sync': (cursors: CursorPosition[]) => void

  // Channel events
  'channel:message': (message: ChannelMessage) => void
  'channel:history': (messages: ChannelMessage[]) => void
  'channel:typing': (clientId: string, isTyping: boolean) => void

  // Whiteboard events
  'whiteboard:draw': (shape: Shape) => void
  'whiteboard:update': (shapeId: string, updates: Partial<Shape>) => void
  'whiteboard:delete': (shapeIds: string[]) => void
  'whiteboard:sync': (shapes: Shape[], cursors: CursorPosition[]) => void
}

type EventHandler<T extends keyof ClientEvents> = ClientEvents[T]

// ============================================================================
// CollaborationClient Class
// ============================================================================

export class CollaborationClient {
  private ws: WebSocket | null = null
  private options: Required<CollaborationClientOptions>
  private doc: YDoc
  private state: ConnectionState = CONNECTION_STATE.DISCONNECTED
  private reconnectAttempt: number = 0
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private pendingOperations: Operation[] = []
  private eventHandlers: Map<string, Set<Function>> = new Map()

  // Presence state
  private users: Map<string, PresenceUser> = new Map()
  private cursors: Map<string, CursorPosition> = new Map()

  constructor(options: CollaborationClientOptions) {
    this.options = {
      url: options.url,
      documentId: options.documentId ?? 'default',
      channelId: options.channelId ?? 'general',
      clientId: options.clientId ?? this.generateClientId(),
      userId: options.userId ?? undefined,
      userName: options.userName ?? undefined,
      userColor: options.userColor ?? this.generateColor(),
      auth: options.auth ?? undefined,
      autoReconnect: options.autoReconnect ?? true,
      heartbeatInterval: options.heartbeatInterval ?? TIMEOUTS.HEARTBEAT_INTERVAL,
    } as Required<CollaborationClientOptions>

    this.doc = new YDoc({ clientId: this.options.clientId })

    // Set up document update handler
    this.doc.onUpdate((ops, origin) => {
      if (origin === 'local') {
        this.sendOperations(ops)
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect to the collaboration server
   */
  connect(): void {
    if (this.state === CONNECTION_STATE.CONNECTED || this.state === CONNECTION_STATE.CONNECTING) {
      return
    }

    this.state = CONNECTION_STATE.CONNECTING

    try {
      this.ws = new WebSocket(this.options.url)

      this.ws.onopen = () => {
        this.handleOpen()
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = (event) => {
        this.handleClose(event.reason)
      }

      this.ws.onerror = (event) => {
        this.handleError(new Error('WebSocket error'))
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.options.autoReconnect = false
    this.cleanup()
    this.state = CONNECTION_STATE.DISCONNECTED
    this.emit('disconnect')
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === CONNECTION_STATE.CONNECTED
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the document
   */
  getDocument(): YDoc {
    return this.doc
  }

  /**
   * Insert text at position
   */
  insertText(index: number, content: string): void {
    const text = this.doc.getText()
    this.doc.transact(() => {
      const ops = text.insert(this.doc.clock, index, content)
      ops.forEach(op => this.doc.recordOperation(op))
    })
  }

  /**
   * Delete text at position
   */
  deleteText(index: number, length: number): void {
    const text = this.doc.getText()
    this.doc.transact(() => {
      const ops = text.delete(this.doc.clock, index, length)
      ops.forEach(op => this.doc.recordOperation(op))
    })
  }

  /**
   * Get document content
   */
  getContent(): string {
    return this.doc.getText().toString()
  }

  /**
   * Undo last operation
   */
  undo(): boolean {
    return this.doc.undo()
  }

  /**
   * Redo last undone operation
   */
  redo(): boolean {
    return this.doc.redo()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRESENCE & CURSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get online users
   */
  getUsers(): PresenceUser[] {
    return Array.from(this.users.values())
  }

  /**
   * Update presence info
   */
  updatePresence(updates: Partial<PresenceUser>): void {
    this.send({
      type: 'presence:update',
      clientId: this.options.clientId,
      roomId: this.options.documentId,
      updates,
    })
  }

  /**
   * Update cursor position
   */
  updateCursor(position: { index?: number; length?: number; x?: number; y?: number }): void {
    this.send({
      type: 'cursor:update',
      cursor: {
        clientId: this.options.clientId,
        documentId: this.options.documentId,
        ...position,
        color: this.options.userColor,
        name: this.options.userName,
      },
    })
  }

  /**
   * Get cursor positions
   */
  getCursors(): CursorPosition[] {
    return Array.from(this.cursors.values())
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHANNEL MESSAGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to a channel
   */
  subscribeChannel(channelId: string): void {
    this.send({
      type: 'channel:subscribe',
      channelId,
    })
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeChannel(channelId: string): void {
    this.send({
      type: 'channel:unsubscribe',
      channelId,
    })
  }

  /**
   * Send a chat message
   */
  sendMessage(content: string, channelId?: string): void {
    this.send({
      type: 'channel:message',
      message: {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        channelId: channelId ?? this.options.channelId,
        senderId: this.options.clientId,
        senderName: this.options.userName,
        content,
        type: 'text',
        timestamp: Date.now(),
      },
    })
  }

  /**
   * Send typing indicator
   */
  sendTyping(isTyping: boolean, channelId?: string): void {
    this.send({
      type: 'channel:typing',
      channelId: channelId ?? this.options.channelId,
      clientId: this.options.clientId,
      isTyping,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WHITEBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Draw a shape
   */
  drawShape(shape: Omit<Shape, 'id' | 'createdAt' | 'updatedAt' | 'zIndex' | 'createdBy'>): void {
    this.send({
      type: 'whiteboard:draw',
      boardId: this.options.documentId,
      shape: {
        ...shape,
        id: `shape_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdBy: this.options.clientId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        zIndex: 0,
      },
    })
  }

  /**
   * Update a shape
   */
  updateShape(shapeId: string, updates: Partial<Shape>): void {
    this.send({
      type: 'whiteboard:update',
      boardId: this.options.documentId,
      shapeId,
      updates,
    })
  }

  /**
   * Delete shapes
   */
  deleteShapes(shapeIds: string[]): void {
    this.send({
      type: 'whiteboard:delete',
      boardId: this.options.documentId,
      shapeIds,
    })
  }

  /**
   * Lock a shape for editing
   */
  lockShape(shapeId: string): void {
    this.send({
      type: 'whiteboard:lock',
      boardId: this.options.documentId,
      shapeId,
      clientId: this.options.clientId,
    })
  }

  /**
   * Unlock a shape
   */
  unlockShape(shapeId: string): void {
    this.send({
      type: 'whiteboard:unlock',
      boardId: this.options.documentId,
      shapeId,
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to an event
   */
  on<T extends keyof ClientEvents>(event: T, handler: EventHandler<T>): () => void {
    let handlers = this.eventHandlers.get(event)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(event, handlers)
    }
    handlers.add(handler)

    return () => {
      handlers?.delete(handler)
    }
  }

  /**
   * Emit an event
   */
  private emit<T extends keyof ClientEvents>(event: T, ...args: Parameters<EventHandler<T>>): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as Function)(...args)
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error)
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  private handleOpen(): void {
    this.state = CONNECTION_STATE.CONNECTED
    this.reconnectAttempt = 0

    // Send connect message
    this.send({
      type: 'connect',
      clientId: this.options.clientId,
      documentId: this.options.documentId,
      channelId: this.options.channelId,
      auth: this.options.auth ? { token: this.options.auth.token, userId: this.options.userId } : undefined,
    })

    // Start heartbeat
    this.startHeartbeat()

    // Send any pending operations
    if (this.pendingOperations.length > 0) {
      this.sendOperations(this.pendingOperations)
      this.pendingOperations = []
    }

    this.emit('connect')
  }

  private handleClose(reason?: string): void {
    this.cleanup()
    this.state = CONNECTION_STATE.DISCONNECTED

    if (this.options.autoReconnect) {
      this.scheduleReconnect()
    } else {
      this.emit('disconnect', reason)
    }
  }

  private handleError(error: Error): void {
    this.emit('error', error)
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const msg = decodeMessage(data)
      this.routeMessage(msg)
    } catch (error) {
      console.error('Error parsing message:', error)
    }
  }

  private routeMessage(msg: Message): void {
    switch (msg.type) {
      case 'connected':
        // Already handled in handleOpen
        break

      case 'pong':
        // Heartbeat response, update last activity
        break

      case 'error':
        this.emit('error', new Error((msg as any).message))
        break

      // Sync messages
      case 'sync:response':
        this.handleSyncResponse(msg as any)
        break

      case 'sync:update':
        this.handleSyncUpdate(msg as any)
        break

      case 'sync:ack':
        // Operation acknowledged
        break

      // Presence messages
      case 'presence:join':
        this.handlePresenceJoin(msg as any)
        break

      case 'presence:leave':
        this.handlePresenceLeave(msg as any)
        break

      case 'presence:update':
        this.handlePresenceUpdate(msg as any)
        break

      case 'presence:sync':
        this.handlePresenceSync(msg as any)
        break

      // Cursor messages
      case 'cursor:update':
        this.handleCursorUpdate(msg as any)
        break

      case 'cursor:sync':
        this.handleCursorSync(msg as any)
        break

      // Channel messages
      case 'channel:message':
        this.emit('channel:message', (msg as any).message)
        break

      case 'channel:history':
        this.emit('channel:history', (msg as any).messages)
        break

      case 'channel:typing':
        this.emit('channel:typing', (msg as any).clientId, (msg as any).isTyping)
        break

      // Whiteboard messages
      case 'whiteboard:draw':
        this.emit('whiteboard:draw', (msg as any).shape)
        break

      case 'whiteboard:update':
        this.emit('whiteboard:update', (msg as any).shapeId, (msg as any).updates)
        break

      case 'whiteboard:delete':
        this.emit('whiteboard:delete', (msg as any).shapeIds)
        break

      case 'whiteboard:sync':
        this.emit('whiteboard:sync', (msg as any).shapes, (msg as any).cursors)
        break
    }
  }

  private handleSyncResponse(msg: { state: string; version: number; stateVector: Record<string, number> }): void {
    try {
      const bytes = Uint8Array.from(atob(msg.state), c => c.charCodeAt(0))
      this.doc.applyState(bytes)
      this.emit('sync:synced')
    } catch (error) {
      console.error('Error applying sync response:', error)
    }
  }

  private handleSyncUpdate(msg: { operations: Operation[]; origin: string }): void {
    this.doc.applyOperations(msg.operations, msg.origin)
    this.emit('sync:update', msg.operations, msg.origin)
  }

  private handlePresenceJoin(msg: { user: PresenceUser }): void {
    this.users.set(msg.user.clientId, msg.user)
    this.emit('presence:join', msg.user)
  }

  private handlePresenceLeave(msg: { clientId: string }): void {
    this.users.delete(msg.clientId)
    this.cursors.delete(msg.clientId)
    this.emit('presence:leave', msg.clientId)
  }

  private handlePresenceUpdate(msg: { clientId: string; updates: Partial<PresenceUser> }): void {
    const user = this.users.get(msg.clientId)
    if (user) {
      Object.assign(user, msg.updates)
      this.emit('presence:update', msg.clientId, msg.updates)
    }
  }

  private handlePresenceSync(msg: { users: PresenceUser[] }): void {
    this.users.clear()
    for (const user of msg.users) {
      this.users.set(user.clientId, user)
    }
    this.emit('presence:sync', msg.users)
  }

  private handleCursorUpdate(msg: { cursor: CursorPosition }): void {
    this.cursors.set(msg.cursor.clientId, msg.cursor)
    this.emit('cursor:update', msg.cursor)
  }

  private handleCursorSync(msg: { cursors: CursorPosition[] }): void {
    this.cursors.clear()
    for (const cursor of msg.cursors) {
      this.cursors.set(cursor.clientId, cursor)
    }
    this.emit('cursor:sync', msg.cursors)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  private send(msg: Message): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(msg))
    }
  }

  private sendOperations(operations: Operation[]): void {
    if (!this.isConnected()) {
      // Queue for later
      this.pendingOperations.push(...operations)
      return
    }

    this.send({
      type: 'sync:update',
      documentId: this.options.documentId,
      operations,
      origin: this.options.clientId,
      version: this.doc.getVersion(),
    })
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'ping' })
    }, this.options.heartbeatInterval)
  }

  private scheduleReconnect(): void {
    this.state = CONNECTION_STATE.RECONNECTING
    this.reconnectAttempt++

    const delay = Math.min(
      TIMEOUTS.RECONNECT_BASE * Math.pow(2, this.reconnectAttempt - 1),
      TIMEOUTS.RECONNECT_MAX
    )

    this.emit('reconnecting', this.reconnectAttempt)

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }

      this.ws = null
    }
  }

  private generateClientId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private generateColor(): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
    return colors[Math.floor(Math.random() * colors.length)]
  }

  /**
   * Destroy the client
   */
  destroy(): void {
    this.disconnect()
    this.doc.destroy()
    this.users.clear()
    this.cursors.clear()
    this.eventHandlers.clear()
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a collaboration client
 */
export function createCollaborationClient(options: CollaborationClientOptions): CollaborationClient {
  return new CollaborationClient(options)
}

export default CollaborationClient
