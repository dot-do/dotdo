// WebSocket Chat Durable Object
// Demonstrates: Real-time messaging, WebSocket management, presence, typing indicators
// Key patterns: ws.on handlers, ws.broadcast, hibernatable WebSockets, $.on events

import { Hono } from 'hono'
import { DO, type DOEnv, createContext, type WorkflowContext } from '../../do'
import type {
  Room,
  Participant,
  ChatMessage,
  TypingState,
  JoinRoomMessage,
  LeaveRoomMessage,
  SendMessage,
  EditMessage,
  DeleteMessage,
  TypingMessage,
} from './types'

// Message history limit
const MAX_RECENT_MESSAGES = 50
const TYPING_TIMEOUT_MS = 5000

export class ChatDO extends DO {
  protected declare override $: WorkflowContext

  // In-memory state for active session
  private userConnections: Map<string, WebSocket> = new Map()
  private typingUsers: Map<string, TypingState> = new Map()

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)

    // Initialize WorkflowContext
    this.$ = createContext(state, env)

    // ========================================================================
    // Event Handlers using $.on.Noun.verb pattern
    // ========================================================================

    this.$.on.Message.sent(async (event) => {
      const { roomId, messageId, userId } = event.payload as {
        roomId: string
        messageId: string
        userId: string
      }
      console.log(`[Event] Message sent in room ${roomId} by ${userId}: ${messageId}`)
    })

    this.$.on.User.joined(async (event) => {
      const { roomId, userId, userName } = event.payload as {
        roomId: string
        userId: string
        userName: string
      }
      console.log(`[Event] ${userName} (${userId}) joined room ${roomId}`)
    })

    this.$.on.User.left(async (event) => {
      const { roomId, userId } = event.payload as {
        roomId: string
        userId: string
      }
      console.log(`[Event] User ${userId} left room ${roomId}`)
    })

    // Audit all chat events
    this.$.on.Message['*'](async (event) => {
      console.log(`[Audit] Message event: ${event.type}`)
    })

    // ========================================================================
    // Scheduled Tasks - Clean up typing indicators
    // ========================================================================

    this.$.every.minute(async () => {
      const now = Date.now()
      for (const [userId, state] of this.typingUsers.entries()) {
        if (now - new Date(state.startedAt).getTime() > TYPING_TIMEOUT_MS) {
          this.typingUsers.delete(userId)
        }
      }
    })

    // ========================================================================
    // WebSocket Message Handlers
    // ========================================================================

    this.ws.on('join', this.handleJoin.bind(this))
    this.ws.on('leave', this.handleLeave.bind(this))
    this.ws.on('message', this.handleMessage.bind(this))
    this.ws.on('edit', this.handleEdit.bind(this))
    this.ws.on('delete', this.handleDelete.bind(this))
    this.ws.on('typing', this.handleTyping.bind(this))
    this.ws.on('ping', this.handlePing.bind(this))
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Room Management (REST API)
    // ========================================================================

    // List rooms
    app.get('/rooms', async (c) => {
      const rooms = await this.things.list({ type: 'Room' })
      return c.json({
        data: rooms.map((r) => ({
          ...r,
          _links: {
            self: { href: `/rooms/${r.$id}` },
            messages: { href: `/rooms/${r.$id}/messages` },
            ws: { href: `/ws/${r.$id}` },
          },
        })),
      })
    })

    // Create room
    app.post('/rooms', async (c) => {
      const body = await c.req.json<{
        name: string
        description?: string
        isPrivate?: boolean
        maxMembers?: number
        createdBy: string
      }>()

      if (!body.name || !body.createdBy) {
        return c.json({ error: 'Name and createdBy are required' }, 400)
      }

      const room = await this.things.create({
        $type: 'Room',
        name: body.name,
        description: body.description,
        isPrivate: body.isPrivate || false,
        maxMembers: body.maxMembers,
        createdBy: body.createdBy,
        createdAt: new Date().toISOString(),
      })

      // Add creator as owner
      await this.things.create({
        $type: 'Participant',
        roomId: room.$id,
        userId: body.createdBy,
        userName: body.createdBy,
        role: 'owner',
        joinedAt: new Date().toISOString(),
      })

      c.header('Location', `/rooms/${room.$id}`)
      return c.json(room, 201)
    })

    // Get room
    app.get('/rooms/:id', async (c) => {
      const roomId = c.req.param('id')
      const room = await this.things.get(roomId)

      if (!room || room.$type !== 'Room') {
        return c.json({ error: 'Room not found' }, 404)
      }

      // Get participants
      const allParticipants = await this.things.list({ type: 'Participant' })
      const participants = allParticipants.filter(
        (p) => (p as unknown as Participant).roomId === roomId
      )

      // Get online status
      const participantsWithStatus = participants.map((p) => ({
        ...p,
        online: this.userConnections.has((p as unknown as Participant).userId),
      }))

      return c.json({
        room,
        participants: participantsWithStatus,
        _links: {
          self: { href: `/rooms/${roomId}` },
          messages: { href: `/rooms/${roomId}/messages` },
          ws: { href: `/ws/${roomId}` },
        },
      })
    })

    // Delete room
    app.delete('/rooms/:id', async (c) => {
      const roomId = c.req.param('id')

      // Delete all messages
      const messages = await this.things.list({ type: 'ChatMessage' })
      for (const msg of messages) {
        if ((msg as unknown as ChatMessage).roomId === roomId) {
          await this.things.delete(msg.$id)
        }
      }

      // Delete all participants
      const participants = await this.things.list({ type: 'Participant' })
      for (const p of participants) {
        if ((p as unknown as Participant).roomId === roomId) {
          await this.things.delete(p.$id)
        }
      }

      // Delete room
      await this.things.delete(roomId)

      return c.body(null, 204)
    })

    // ========================================================================
    // Messages (REST API)
    // ========================================================================

    // Get room messages
    app.get('/rooms/:roomId/messages', async (c) => {
      const roomId = c.req.param('roomId')
      const limit = parseInt(c.req.query('limit') || '50')
      const before = c.req.query('before') // cursor for pagination

      const allMessages = await this.things.list({ type: 'ChatMessage' })
      let messages = (allMessages as unknown as (ChatMessage & { $id: string })[])
        .filter((m) => m.roomId === roomId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )

      // Apply cursor-based pagination
      if (before) {
        const idx = messages.findIndex((m) => m.$id === before)
        if (idx !== -1) {
          messages = messages.slice(idx + 1)
        }
      }

      messages = messages.slice(0, limit)

      return c.json({
        data: messages,
        pagination: {
          hasMore: messages.length === limit,
          nextCursor: messages[messages.length - 1]?.$id,
        },
      })
    })

    // ========================================================================
    // WebSocket Upgrade
    // ========================================================================

    // WebSocket endpoint for room
    app.get('/ws/:roomId', async (c) => {
      const roomId = c.req.param('roomId')

      // Verify room exists
      const room = await this.things.get(roomId)
      if (!room || room.$type !== 'Room') {
        return c.json({ error: 'Room not found' }, 404)
      }

      // Check for WebSocket upgrade
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json({ error: 'Expected websocket upgrade' }, 426)
      }

      // Accept WebSocket with room tag for targeted broadcasts
      return this.ws.handleWebSocketUpgrade(
        this.state,
        [`room:${roomId}`],
        true // hibernatable
      )
    })

    // ========================================================================
    // Presence API
    // ========================================================================

    // Get online users in room
    app.get('/rooms/:roomId/presence', async (c) => {
      const roomId = c.req.param('roomId')

      const participants = await this.things.list({ type: 'Participant' })
      const roomParticipants = (participants as unknown as (Participant & { $id: string })[])
        .filter((p) => p.roomId === roomId)

      const online = roomParticipants
        .filter((p) => this.userConnections.has(p.userId))
        .map((p) => ({
          userId: p.userId,
          userName: p.userName,
          avatar: p.avatar,
        }))

      const typing = Array.from(this.typingUsers.values())
        .filter((t) =>
          roomParticipants.some((p) => p.userId === t.userId)
        )
        .map((t) => ({
          userId: t.userId,
          userName: t.userName,
        }))

      return c.json({
        online,
        typing,
        total: roomParticipants.length,
        onlineCount: online.length,
      })
    })
  }

  // ==========================================================================
  // WebSocket Message Handlers
  // ==========================================================================

  private async handleJoin(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as JoinRoomMessage
    const { roomId, userId, userName, avatar } = msg

    // Verify room exists
    const room = await this.things.get(roomId)
    if (!room || room.$type !== 'Room') {
      this.ws.send(ws, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Room does not exist',
      })
      return
    }

    const roomData = room as unknown as Room & { $id: string }

    // Check member limit
    if (roomData.maxMembers) {
      const participants = await this.things.list({ type: 'Participant' })
      const roomParticipants = participants.filter(
        (p) => (p as unknown as Participant).roomId === roomId
      )
      if (roomParticipants.length >= roomData.maxMembers) {
        this.ws.send(ws, {
          type: 'error',
          code: 'ROOM_FULL',
          message: 'Room has reached maximum capacity',
        })
        return
      }
    }

    // Get or create participant
    const existingParticipants = await this.things.list({ type: 'Participant' })
    let participant = existingParticipants.find(
      (p) =>
        (p as unknown as Participant).roomId === roomId &&
        (p as unknown as Participant).userId === userId
    ) as (Participant & { $id: string }) | undefined

    if (!participant) {
      participant = (await this.things.create({
        $type: 'Participant',
        roomId,
        userId,
        userName,
        avatar,
        role: 'member',
        joinedAt: new Date().toISOString(),
      })) as unknown as Participant & { $id: string }

      // System message for new user
      const systemMsg = await this.things.create({
        $type: 'ChatMessage',
        roomId,
        userId: 'system',
        userName: 'System',
        content: `${userName} joined the room`,
        type: 'system',
        createdAt: new Date().toISOString(),
      })

      // Broadcast system message
      this.ws.broadcast(this.state, `room:${roomId}`, {
        type: 'new_message',
        message: systemMsg,
      })
    }

    // Track connection
    this.userConnections.set(userId, ws)

    // Update last seen
    await this.things.update(participant.$id, {
      lastSeenAt: new Date().toISOString(),
    })

    // Get all participants with online status
    const allParticipants = await this.things.list({ type: 'Participant' })
    const roomParticipants = (allParticipants as unknown as (Participant & { $id: string })[])
      .filter((p) => p.roomId === roomId)
      .map((p) => ({
        userId: p.userId,
        userName: p.userName,
        avatar: p.avatar,
        role: p.role,
        online: this.userConnections.has(p.userId),
      }))

    // Get recent messages
    const allMessages = await this.things.list({ type: 'ChatMessage' })
    const recentMessages = (allMessages as unknown as ChatMessage[])
      .filter((m) => m.roomId === roomId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, MAX_RECENT_MESSAGES)
      .reverse()

    // Send room state to joining user
    this.ws.send(ws, {
      type: 'room_state',
      room: roomData,
      participants: roomParticipants,
      recentMessages,
    })

    // Broadcast user joined to others
    this.broadcastToRoom(roomId, ws, {
      type: 'user_joined',
      userId,
      userName,
      avatar,
    })

    // Fire event
    this.$.send({
      type: 'User.joined',
      payload: { roomId, userId, userName },
    })
  }

  private async handleLeave(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as LeaveRoomMessage
    const { roomId, userId } = msg

    // Remove from tracking
    this.userConnections.delete(userId)
    this.typingUsers.delete(userId)

    // Get user name
    const participants = await this.things.list({ type: 'Participant' })
    const participant = participants.find(
      (p) =>
        (p as unknown as Participant).roomId === roomId &&
        (p as unknown as Participant).userId === userId
    ) as (Participant & { $id: string }) | undefined

    if (participant) {
      const participantData = participant as unknown as Participant

      // Broadcast user left
      this.ws.broadcast(this.state, `room:${roomId}`, {
        type: 'user_left',
        userId,
        userName: participantData.userName,
      })

      // Fire event
      this.$.send({
        type: 'User.left',
        payload: { roomId, userId },
      })
    }
  }

  private async handleMessage(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as SendMessage & { userId: string; userName: string }
    const { roomId, content, replyTo, userId, userName } = msg

    if (!content || content.trim() === '') {
      this.ws.send(ws, {
        type: 'error',
        code: 'EMPTY_MESSAGE',
        message: 'Message content cannot be empty',
      })
      return
    }

    // Create message
    const chatMessage = await this.things.create({
      $type: 'ChatMessage',
      roomId,
      userId,
      userName,
      content: content.trim(),
      type: 'text',
      replyTo,
      createdAt: new Date().toISOString(),
    })

    // Clear typing state
    this.typingUsers.delete(userId)

    // Send ack to sender
    this.ws.send(ws, {
      type: 'ack',
      messageId: chatMessage.$id,
    })

    // Broadcast to all in room (including sender for consistency)
    this.ws.broadcast(this.state, `room:${roomId}`, {
      type: 'new_message',
      message: chatMessage,
    })

    // Broadcast typing update
    this.broadcastTypingState(roomId)

    // Fire event
    this.$.send({
      type: 'Message.sent',
      payload: { roomId, messageId: chatMessage.$id, userId },
    })
  }

  private async handleEdit(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as EditMessage & { userId: string }
    const { messageId, content, userId } = msg

    const message = await this.things.get(messageId)
    if (!message || message.$type !== 'ChatMessage') {
      this.ws.send(ws, {
        type: 'error',
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
      })
      return
    }

    const msgData = message as unknown as ChatMessage

    // Check ownership
    if (msgData.userId !== userId) {
      this.ws.send(ws, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: 'You can only edit your own messages',
      })
      return
    }

    // Update message
    const editedAt = new Date().toISOString()
    await this.things.update(messageId, {
      content: content.trim(),
      editedAt,
    })

    // Broadcast edit
    this.ws.broadcast(this.state, `room:${msgData.roomId}`, {
      type: 'message_edited',
      messageId,
      content: content.trim(),
      editedAt,
    })

    // Fire event
    this.$.send({
      type: 'Message.edited',
      payload: { roomId: msgData.roomId, messageId, userId },
    })
  }

  private async handleDelete(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as DeleteMessage & { userId: string }
    const { messageId, userId } = msg

    const message = await this.things.get(messageId)
    if (!message || message.$type !== 'ChatMessage') {
      this.ws.send(ws, {
        type: 'error',
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
      })
      return
    }

    const msgData = message as unknown as ChatMessage

    // Check ownership (or moderator/owner role)
    const participants = await this.things.list({ type: 'Participant' })
    const participant = participants.find(
      (p) =>
        (p as unknown as Participant).roomId === msgData.roomId &&
        (p as unknown as Participant).userId === userId
    ) as (Participant & { $id: string }) | undefined

    const isOwnerOrMod =
      participant &&
      ((participant as unknown as Participant).role === 'owner' ||
        (participant as unknown as Participant).role === 'moderator')

    if (msgData.userId !== userId && !isOwnerOrMod) {
      this.ws.send(ws, {
        type: 'error',
        code: 'UNAUTHORIZED',
        message: 'You can only delete your own messages',
      })
      return
    }

    // Delete message
    await this.things.delete(messageId)

    // Broadcast deletion
    this.ws.broadcast(this.state, `room:${msgData.roomId}`, {
      type: 'message_deleted',
      messageId,
    })

    // Fire event
    this.$.send({
      type: 'Message.deleted',
      payload: { roomId: msgData.roomId, messageId, userId },
    })
  }

  private async handleTyping(ws: WebSocket, data: unknown): Promise<void> {
    const msg = data as TypingMessage & { userId: string; userName: string }
    const { roomId, isTyping, userId, userName } = msg

    if (isTyping) {
      this.typingUsers.set(userId, {
        userId,
        userName,
        startedAt: new Date().toISOString(),
      })
    } else {
      this.typingUsers.delete(userId)
    }

    // Broadcast typing state to others in room
    this.broadcastTypingState(roomId, ws)
  }

  private handlePing(ws: WebSocket, _data: unknown): void {
    this.ws.send(ws, { type: 'pong', timestamp: Date.now() })
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private broadcastToRoom(
    roomId: string,
    excludeWs: WebSocket | null,
    message: unknown
  ): void {
    const sockets = this.state.getWebSockets(`room:${roomId}`)
    for (const socket of sockets) {
      if (socket !== excludeWs) {
        this.ws.send(socket, message)
      }
    }
  }

  private async broadcastTypingState(
    roomId: string,
    excludeWs?: WebSocket
  ): Promise<void> {
    // Get participants in room
    const participants = await this.things.list({ type: 'Participant' })
    const roomParticipants = (participants as unknown as Participant[]).filter(
      (p) => p.roomId === roomId
    )

    // Filter typing users to those in this room
    const typingInRoom = Array.from(this.typingUsers.values()).filter((t) =>
      roomParticipants.some((p) => p.userId === t.userId)
    )

    this.broadcastToRoom(roomId, excludeWs || null, {
      type: 'typing_update',
      users: typingInRoom.map((t) => ({
        userId: t.userId,
        userName: t.userName,
      })),
    })
  }

  // ==========================================================================
  // WebSocket Lifecycle Overrides
  // ==========================================================================

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    // Find and clean up the user who disconnected
    for (const [userId, socket] of this.userConnections.entries()) {
      if (socket === ws) {
        this.userConnections.delete(userId)
        this.typingUsers.delete(userId)

        // Get user's rooms and broadcast leave
        const participants = await this.things.list({ type: 'Participant' })
        const userParticipants = (
          participants as unknown as (Participant & { $id: string })[]
        ).filter((p) => p.userId === userId)

        for (const p of userParticipants) {
          this.ws.broadcast(this.state, `room:${p.roomId}`, {
            type: 'user_left',
            userId,
            userName: p.userName,
          })
        }
        break
      }
    }

    await super.webSocketClose(ws, code, reason, wasClean)
  }
}

// Export for worker binding
export { ChatDO as DO }
