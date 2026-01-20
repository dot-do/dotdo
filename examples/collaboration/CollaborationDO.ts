// Real-time Document Collaboration Durable Object
// Demonstrates: WebSockets, presence, operational transformation, events

import { Hono } from 'hono'
import { DO, type DOEnv } from '../../do'
import type {
  Document,
  Collaborator,
  CursorPosition,
  Operation,
  DocumentChange,
  Comment,
  WSMessage,
  JoinMessage,
  EditMessage,
  CursorMessage,
} from './types'

// Generate random cursor colors
const CURSOR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
]

function getRandomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
}

export class CollaborationDO extends DO {
  // In-memory state for active session
  private cursors: Map<string, CursorPosition> = new Map()
  private userConnections: Map<string, WebSocket> = new Map()

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // Register WebSocket message handlers
    this.ws.on('join', this.handleJoin.bind(this))
    this.ws.on('leave', this.handleLeave.bind(this))
    this.ws.on('edit', this.handleEdit.bind(this))
    this.ws.on('cursor', this.handleCursor.bind(this))
    this.ws.on('sync', this.handleSync.bind(this))
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Document Management
    // ========================================================================

    // Get document
    app.get('/documents/:id', async (c) => {
      const doc = await this.things.get(c.req.param('id'))
      if (!doc || doc.$type !== 'Document') {
        return c.json({ error: 'Document not found' }, 404)
      }
      return c.json(doc)
    })

    // Create document
    app.post('/documents', async (c) => {
      const { title, content = '' } = await c.req.json<{
        title: string
        content?: string
      }>()

      const doc = await this.things.create({
        $type: 'Document',
        title,
        content,
        version: 0,
      })

      await this.events.emit({
        type: 'Document.created',
        payload: { documentId: doc.$id, title },
        source: doc.$id,
      })

      return c.json(doc, 201)
    })

    // Update document title
    app.patch('/documents/:id', async (c) => {
      const docId = c.req.param('id')
      const { title } = await c.req.json<{ title: string }>()

      const doc = await this.things.update(docId, { title })
      return c.json(doc)
    })

    // List documents
    app.get('/documents', async (c) => {
      const docs = await this.things.list({ type: 'Document' })
      return c.json(docs)
    })

    // ========================================================================
    // WebSocket Connection
    // ========================================================================

    // WebSocket upgrade endpoint
    app.get('/ws/:documentId', async (c) => {
      const documentId = c.req.param('documentId')

      // Verify document exists
      const doc = await this.things.get(documentId)
      if (!doc || doc.$type !== 'Document') {
        return c.json({ error: 'Document not found' }, 404)
      }

      // Upgrade to WebSocket
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Expected websocket upgrade' }, 426)
      }

      // Accept WebSocket with document tag for targeted broadcasts
      return this.ws.handleWebSocketUpgrade(
        this.state,
        [`doc:${documentId}`],
        true // hibernatable
      )
    })

    // ========================================================================
    // Collaborators
    // ========================================================================

    // Get active collaborators for a document
    app.get('/documents/:id/collaborators', async (c) => {
      const documentId = c.req.param('id')
      const collaborators: Array<{
        userId: string
        name: string
        color: string
        cursor?: CursorPosition
      }> = []

      // Get all collaborators who have joined this document
      const allCollaborators = await this.things.list({ type: 'Collaborator' })
      for (const collab of allCollaborators) {
        const c = collab as unknown as Collaborator
        if (this.userConnections.has(c.userId)) {
          collaborators.push({
            userId: c.userId,
            name: c.name,
            color: c.color,
            cursor: this.cursors.get(c.userId),
          })
        }
      }

      return c.json(collaborators)
    })

    // ========================================================================
    // Comments
    // ========================================================================

    // Add comment
    app.post('/documents/:id/comments', async (c) => {
      const documentId = c.req.param('id')
      const { userId, userName, content, position } = await c.req.json<{
        userId: string
        userName: string
        content: string
        position: { start: number; end: number }
      }>()

      const comment = await this.things.create({
        $type: 'Comment',
        documentId,
        userId,
        userName,
        content,
        position,
        resolved: false,
        createdAt: new Date().toISOString(),
      })

      // Broadcast comment to all collaborators
      this.ws.broadcast(this.state, `doc:${documentId}`, {
        type: 'comment',
        comment,
      })

      await this.events.emit({
        type: 'Comment.added',
        payload: { documentId, commentId: comment.$id, userId },
        source: documentId,
      })

      return c.json(comment, 201)
    })

    // List comments
    app.get('/documents/:id/comments', async (c) => {
      const documentId = c.req.param('id')
      const allComments = await this.things.list({ type: 'Comment' })
      const comments = allComments.filter(
        (t) => (t as unknown as Comment).documentId === documentId
      )
      return c.json(comments)
    })

    // Resolve comment
    app.post('/documents/:docId/comments/:commentId/resolve', async (c) => {
      const { docId, commentId } = c.req.param() as { docId: string; commentId: string }
      const { userId } = await c.req.json<{ userId: string }>()

      const comment = await this.things.update(commentId, {
        resolved: true,
        resolvedAt: new Date().toISOString(),
        resolvedBy: userId,
      })

      // Broadcast resolution
      this.ws.broadcast(this.state, `doc:${docId}`, {
        type: 'comment_resolved',
        commentId,
        resolvedBy: userId,
      })

      return c.json(comment)
    })

    // ========================================================================
    // History
    // ========================================================================

    // Get document change history
    app.get('/documents/:id/history', async (c) => {
      const documentId = c.req.param('id')
      const events = await this.events.query({
        source: documentId,
        type: 'Document.edited',
      })
      return c.json(events)
    })
  }

  // ==========================================================================
  // WebSocket Message Handlers
  // ==========================================================================

  private async handleJoin(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as JoinMessage
    const { documentId, userId, userName } = msg

    // Get or create collaborator
    let collaborator = (await this.things.list({ type: 'Collaborator' }))
      .find((t) => (t as unknown as Collaborator).userId === userId) as Collaborator | undefined

    if (!collaborator) {
      collaborator = await this.things.create({
        $type: 'Collaborator',
        userId,
        name: userName,
        color: getRandomColor(),
      }) as unknown as Collaborator
    }

    // Track connection
    this.userConnections.set(userId, ws)

    // Initialize cursor
    this.cursors.set(userId, {
      userId,
      position: 0,
      updatedAt: new Date().toISOString(),
    })

    // Get document
    const doc = await this.things.get(documentId) as unknown as Document | null
    if (!doc) {
      this.ws.send(ws, { type: 'error', code: 'NOT_FOUND', message: 'Document not found' })
      return
    }

    // Send current document state to joining user
    this.ws.send(ws, {
      type: 'document',
      documentId: doc.$id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
    })

    // Broadcast presence update to all
    await this.broadcastPresence(documentId)

    // Emit join event
    await this.events.emit({
      type: 'Collaborator.joined',
      payload: { documentId, userId, userName },
      source: documentId,
    })
  }

  private async handleLeave(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as { documentId: string; userId: string }

    // Remove from tracking
    this.userConnections.delete(msg.userId)
    this.cursors.delete(msg.userId)

    // Broadcast presence update
    await this.broadcastPresence(msg.documentId)

    await this.events.emit({
      type: 'Collaborator.left',
      payload: { documentId: msg.documentId, userId: msg.userId },
      source: msg.documentId,
    })
  }

  private async handleEdit(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as EditMessage
    const { documentId, userId, operations, baseVersion } = msg

    // Get current document
    const doc = await this.things.get(documentId) as unknown as Document | null
    if (!doc) {
      this.ws.send(ws, { type: 'error', code: 'NOT_FOUND', message: 'Document not found' })
      return
    }

    // Check for version conflict (simplified OT)
    if (baseVersion !== doc.version) {
      // In a real implementation, we'd transform the operations
      // For this example, we reject the edit
      this.ws.send(ws, {
        type: 'error',
        code: 'VERSION_CONFLICT',
        message: 'Document was modified. Please sync and retry.',
      })
      return
    }

    // Apply operations to content
    let content = doc.content
    for (const op of operations) {
      content = this.applyOperation(content, op)
    }

    // Update document
    const newVersion = doc.version + 1
    await this.things.update(documentId, {
      content,
      version: newVersion,
      lastEditedBy: userId,
    })

    // Store change event
    await this.things.create({
      $type: 'DocumentChange',
      documentId,
      userId,
      version: newVersion,
      operations,
      timestamp: new Date().toISOString(),
    })

    // Send ack to editor
    this.ws.send(ws, {
      type: 'ack',
      documentId,
      version: newVersion,
    })

    // Broadcast edit to other collaborators
    const sockets = this.state.getWebSockets(`doc:${documentId}`)
    for (const socket of sockets) {
      if (socket !== ws) {
        this.ws.send(socket, {
          type: 'edit',
          documentId,
          userId,
          operations,
          version: newVersion,
        })
      }
    }

    // Emit edit event
    await this.events.emit({
      type: 'Document.edited',
      payload: { documentId, userId, version: newVersion, operationCount: operations.length },
      source: documentId,
    })
  }

  private async handleCursor(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as CursorMessage
    const { documentId, userId, position, selection } = msg

    // Update cursor position
    this.cursors.set(userId, {
      userId,
      position,
      selection,
      updatedAt: new Date().toISOString(),
    })

    // Broadcast cursor to others
    const sockets = this.state.getWebSockets(`doc:${documentId}`)
    for (const socket of sockets) {
      if (socket !== ws) {
        this.ws.send(socket, {
          type: 'cursor',
          userId,
          position,
          selection,
        })
      }
    }
  }

  private async handleSync(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as { documentId: string }
    const doc = await this.things.get(msg.documentId) as unknown as Document | null

    if (!doc) {
      this.ws.send(ws, { type: 'error', code: 'NOT_FOUND', message: 'Document not found' })
      return
    }

    this.ws.send(ws, {
      type: 'document',
      documentId: doc.$id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
    })
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private async broadcastPresence(documentId: string): Promise<void> {
    const collaborators: Array<{
      userId: string
      name: string
      color: string
      cursor?: CursorPosition
    }> = []

    // Get active collaborators
    const allCollaborators = await this.things.list({ type: 'Collaborator' })
    for (const collab of allCollaborators) {
      const c = collab as unknown as Collaborator
      if (this.userConnections.has(c.userId)) {
        collaborators.push({
          userId: c.userId,
          name: c.name,
          color: c.color,
          cursor: this.cursors.get(c.userId),
        })
      }
    }

    this.ws.broadcast(this.state, `doc:${documentId}`, {
      type: 'presence',
      documentId,
      collaborators,
    })
  }

  /**
   * Apply a single operation to content (simplified OT)
   */
  private applyOperation(content: string, op: Operation): string {
    switch (op.type) {
      case 'insert':
        return (
          content.slice(0, op.position) +
          (op.content || '') +
          content.slice(op.position)
        )
      case 'delete':
        return (
          content.slice(0, op.position) +
          content.slice(op.position + (op.length || 0))
        )
      case 'retain':
        return content // No change
      default:
        return content
    }
  }

  // ==========================================================================
  // WebSocket Lifecycle Overrides
  // ==========================================================================

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Find and clean up the user who disconnected
    for (const [userId, socket] of this.userConnections.entries()) {
      if (socket === ws) {
        this.userConnections.delete(userId)
        this.cursors.delete(userId)

        // Broadcast presence update to remaining users
        // Note: We need the document ID which we'd normally track
        // For simplicity, broadcast to all sockets
        this.ws.broadcastAll(this.state, {
          type: 'user_left',
          userId,
        })
        break
      }
    }

    await super.webSocketClose(ws, code, reason, wasClean)
  }
}

// Export for worker binding
export { CollaborationDO as DO }
