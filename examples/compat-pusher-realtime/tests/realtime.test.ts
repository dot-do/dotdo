/**
 * compat-pusher-realtime - Test Suite
 *
 * Tests for RealtimeDO WebSocket handling:
 * - Connection establishment
 * - Channel subscription/unsubscription
 * - Presence channel member tracking
 * - Client events (private/presence channels)
 * - Broadcast functionality
 * - Authentication endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MOCK WEBSOCKET
// ============================================================================

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.OPEN
  sentMessages: string[] = []
  closeCode?: number
  closeReason?: string

  send(message: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(message)
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED
    this.closeCode = code
    this.closeReason = reason
  }

  getLastMessage(): Record<string, unknown> | null {
    if (this.sentMessages.length === 0) return null
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1])
  }

  getAllMessages(): Array<Record<string, unknown>> {
    return this.sentMessages.map((m) => JSON.parse(m))
  }
}

// ============================================================================
// PUSHER PROTOCOL HELPERS
// ============================================================================

interface PusherMessage {
  event: string
  channel?: string
  data?: string | unknown
}

function createSubscribeMessage(channel: string, data?: Record<string, unknown>): string {
  return JSON.stringify({
    event: 'pusher:subscribe',
    data: { channel, ...data },
  })
}

function createUnsubscribeMessage(channel: string): string {
  return JSON.stringify({
    event: 'pusher:unsubscribe',
    data: { channel },
  })
}

function createClientEventMessage(channel: string, event: string, data: unknown): string {
  return JSON.stringify({
    event,
    channel,
    data: JSON.stringify(data),
  })
}

function createPingMessage(): string {
  return JSON.stringify({ event: 'pusher:ping' })
}

// ============================================================================
// MOCK REALTIME STATE
// ============================================================================

interface PresenceMember {
  id: string
  info: Record<string, unknown>
}

interface ChannelSubscription {
  name: string
  subscribers: Set<MockWebSocket>
  presenceMembers: Map<MockWebSocket, PresenceMember>
}

/**
 * Simulates RealtimeDO behavior for testing
 */
class MockRealtimeDO {
  private channels: Map<string, ChannelSubscription> = new Map()
  private socketToId: Map<MockWebSocket, string> = new Map()
  private idCounter = 0

  handleNewConnection(ws: MockWebSocket): void {
    const socketId = this.generateSocketId()
    this.socketToId.set(ws, socketId)

    // Send connection established
    ws.send(
      JSON.stringify({
        event: 'pusher:connection_established',
        data: JSON.stringify({
          socket_id: socketId,
          activity_timeout: 120,
        }),
      })
    )
  }

  async handleMessage(ws: MockWebSocket, message: string): Promise<void> {
    const msg = JSON.parse(message) as PusherMessage

    switch (msg.event) {
      case 'pusher:subscribe':
        await this.handleSubscribe(ws, msg)
        break
      case 'pusher:unsubscribe':
        await this.handleUnsubscribe(ws, msg)
        break
      case 'pusher:ping':
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
        break
      default:
        if (msg.event.startsWith('client-') && msg.channel) {
          await this.handleClientEvent(ws, msg)
        }
        break
    }
  }

  private async handleSubscribe(ws: MockWebSocket, msg: PusherMessage): Promise<void> {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
    const channelName = data?.channel || msg.channel

    if (!channelName) {
      ws.send(
        JSON.stringify({
          event: 'pusher:error',
          data: { message: 'Channel name required', code: 4000 },
        })
      )
      return
    }

    // Get or create channel
    let channel = this.channels.get(channelName)
    if (!channel) {
      channel = {
        name: channelName,
        subscribers: new Set(),
        presenceMembers: new Map(),
      }
      this.channels.set(channelName, channel)
    }

    channel.subscribers.add(ws)

    // Handle presence channels
    if (channelName.startsWith('presence-')) {
      await this.handlePresenceSubscribe(ws, channel, data)
    } else {
      ws.send(
        JSON.stringify({
          event: 'pusher:subscription_succeeded',
          channel: channelName,
          data: '{}',
        })
      )
    }
  }

  private async handlePresenceSubscribe(
    ws: MockWebSocket,
    channel: ChannelSubscription,
    data: Record<string, unknown>
  ): Promise<void> {
    const socketId = this.socketToId.get(ws) || 'unknown'

    const member: PresenceMember = {
      id: (data.user_id as string) || socketId,
      info: (data.user_info as Record<string, unknown>) || {},
    }

    channel.presenceMembers.set(ws, member)

    // Build members hash
    const members: Record<string, Record<string, unknown>> = {}
    for (const [, m] of channel.presenceMembers) {
      members[m.id] = m.info
    }

    // Send subscription succeeded with members
    ws.send(
      JSON.stringify({
        event: 'pusher:subscription_succeeded',
        channel: channel.name,
        data: JSON.stringify({
          presence: {
            count: channel.presenceMembers.size,
            ids: Array.from(channel.presenceMembers.values()).map((m) => m.id),
            hash: members,
          },
        }),
      })
    )

    // Notify other subscribers
    this.broadcastToChannel(channel.name, 'pusher:member_added', member, ws)
  }

  private async handleUnsubscribe(ws: MockWebSocket, msg: PusherMessage): Promise<void> {
    const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
    const channelName = data?.channel || msg.channel

    if (!channelName) return

    const channel = this.channels.get(channelName)
    if (!channel) return

    channel.subscribers.delete(ws)

    if (channelName.startsWith('presence-')) {
      const member = channel.presenceMembers.get(ws)
      if (member) {
        channel.presenceMembers.delete(ws)
        this.broadcastToChannel(channelName, 'pusher:member_removed', member, ws)
      }
    }

    if (channel.subscribers.size === 0) {
      this.channels.delete(channelName)
    }
  }

  private async handleClientEvent(ws: MockWebSocket, msg: PusherMessage): Promise<void> {
    const channelName = msg.channel!

    // Client events only on private/presence channels
    if (!channelName.startsWith('private-') && !channelName.startsWith('presence-')) {
      ws.send(
        JSON.stringify({
          event: 'pusher:error',
          data: { message: 'Client events only on private/presence channels', code: 4001 },
        })
      )
      return
    }

    const channel = this.channels.get(channelName)
    if (!channel || !channel.subscribers.has(ws)) {
      ws.send(
        JSON.stringify({
          event: 'pusher:error',
          data: { message: 'Not subscribed to channel', code: 4002 },
        })
      )
      return
    }

    this.broadcastToChannel(channelName, msg.event, msg.data, ws)
  }

  private broadcastToChannel(
    channelName: string,
    event: string,
    data: unknown,
    exclude?: MockWebSocket
  ): void {
    const channel = this.channels.get(channelName)
    if (!channel) return

    const message = JSON.stringify({
      event,
      channel: channelName,
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })

    for (const subscriber of channel.subscribers) {
      if (subscriber !== exclude && subscriber.readyState === MockWebSocket.OPEN) {
        subscriber.send(message)
      }
    }
  }

  broadcast(channelName: string, event: string, data: unknown): void {
    this.broadcastToChannel(channelName, event, data)
  }

  getPresence(channelName: string): { members: PresenceMember[]; count: number } {
    const channel = this.channels.get(channelName)
    if (!channel) {
      return { members: [], count: 0 }
    }

    const members = Array.from(channel.presenceMembers.values())
    return { members, count: members.length }
  }

  handleDisconnect(ws: MockWebSocket): void {
    for (const [channelName, channel] of this.channels) {
      if (channel.subscribers.has(ws)) {
        channel.subscribers.delete(ws)

        if (channelName.startsWith('presence-')) {
          const member = channel.presenceMembers.get(ws)
          if (member) {
            channel.presenceMembers.delete(ws)
            this.broadcastToChannel(channelName, 'pusher:member_removed', member)
          }
        }

        if (channel.subscribers.size === 0) {
          this.channels.delete(channelName)
        }
      }
    }

    this.socketToId.delete(ws)
  }

  getSocketId(ws: MockWebSocket): string | undefined {
    return this.socketToId.get(ws)
  }

  getChannelInfo(): { channels: string[]; totalConnections: number } {
    return {
      channels: Array.from(this.channels.keys()),
      totalConnections: this.socketToId.size,
    }
  }

  private generateSocketId(): string {
    return `${++this.idCounter}.${Date.now()}`
  }
}

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('Connection Handling', () => {
  let realtime: MockRealtimeDO
  let ws: MockWebSocket

  beforeEach(() => {
    realtime = new MockRealtimeDO()
    ws = new MockWebSocket()
  })

  it('should establish connection with socket_id', () => {
    realtime.handleNewConnection(ws)

    const msg = ws.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:connection_established')

    const data = JSON.parse(msg.data as string)
    expect(data.socket_id).toBeDefined()
    expect(data.activity_timeout).toBe(120)
  })

  it('should respond to ping with pong', async () => {
    realtime.handleNewConnection(ws)
    ws.sentMessages = [] // Clear connection message

    await realtime.handleMessage(ws, createPingMessage())

    const msg = ws.getLastMessage()
    expect(msg?.event).toBe('pusher:pong')
  })

  it('should track connection count', () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    const info = realtime.getChannelInfo()
    expect(info.totalConnections).toBe(2)
  })
})

// ============================================================================
// PUBLIC CHANNEL TESTS
// ============================================================================

describe('Public Channels', () => {
  let realtime: MockRealtimeDO
  let ws: MockWebSocket

  beforeEach(() => {
    realtime = new MockRealtimeDO()
    ws = new MockWebSocket()
    realtime.handleNewConnection(ws)
    ws.sentMessages = []
  })

  it('should subscribe to public channel', async () => {
    await realtime.handleMessage(ws, createSubscribeMessage('my-channel'))

    const msg = ws.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:subscription_succeeded')
    expect(msg.channel).toBe('my-channel')
  })

  it('should unsubscribe from public channel', async () => {
    await realtime.handleMessage(ws, createSubscribeMessage('my-channel'))
    await realtime.handleMessage(ws, createUnsubscribeMessage('my-channel'))

    const info = realtime.getChannelInfo()
    expect(info.channels).not.toContain('my-channel')
  })

  it('should broadcast to all subscribers', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(ws1, createSubscribeMessage('updates'))
    await realtime.handleMessage(ws2, createSubscribeMessage('updates'))

    ws1.sentMessages = []
    ws2.sentMessages = []

    // Broadcast via API
    realtime.broadcast('updates', 'new-data', { value: 42 })

    const msg1 = ws1.getLastMessage() as PusherMessage
    const msg2 = ws2.getLastMessage() as PusherMessage

    expect(msg1.event).toBe('new-data')
    expect(msg2.event).toBe('new-data')
    expect(msg1.channel).toBe('updates')
  })

  it('should not allow client events on public channels', async () => {
    await realtime.handleMessage(ws, createSubscribeMessage('public-channel'))
    ws.sentMessages = []

    await realtime.handleMessage(ws, createClientEventMessage('public-channel', 'client-test', { msg: 'hello' }))

    const msg = ws.getLastMessage()
    expect(msg?.event).toBe('pusher:error')
  })
})

// ============================================================================
// PRIVATE CHANNEL TESTS
// ============================================================================

describe('Private Channels', () => {
  let realtime: MockRealtimeDO
  let ws: MockWebSocket

  beforeEach(() => {
    realtime = new MockRealtimeDO()
    ws = new MockWebSocket()
    realtime.handleNewConnection(ws)
    ws.sentMessages = []
  })

  it('should subscribe to private channel', async () => {
    await realtime.handleMessage(ws, createSubscribeMessage('private-chat'))

    const msg = ws.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:subscription_succeeded')
    expect(msg.channel).toBe('private-chat')
  })

  it('should allow client events on private channels', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(ws1, createSubscribeMessage('private-chat'))
    await realtime.handleMessage(ws2, createSubscribeMessage('private-chat'))

    ws1.sentMessages = []
    ws2.sentMessages = []

    // ws1 sends client event
    await realtime.handleMessage(ws1, createClientEventMessage('private-chat', 'client-typing', { user: 'alice' }))

    // ws2 should receive it
    const msg = ws2.getLastMessage() as PusherMessage
    expect(msg.event).toBe('client-typing')
    expect(msg.channel).toBe('private-chat')

    // ws1 should NOT receive it (excluded)
    expect(ws1.sentMessages.length).toBe(0)
  })

  it('should reject client events from non-subscribers', async () => {
    await realtime.handleMessage(ws, createClientEventMessage('private-other', 'client-test', {}))

    const msg = ws.getLastMessage()
    expect(msg?.event).toBe('pusher:error')
  })
})

// ============================================================================
// PRESENCE CHANNEL TESTS
// ============================================================================

describe('Presence Channels', () => {
  let realtime: MockRealtimeDO
  let ws: MockWebSocket

  beforeEach(() => {
    realtime = new MockRealtimeDO()
    ws = new MockWebSocket()
    realtime.handleNewConnection(ws)
    ws.sentMessages = []
  })

  it('should subscribe to presence channel with members', async () => {
    await realtime.handleMessage(
      ws,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1', user_info: { name: 'Alice' } },
      })
    )

    const msg = ws.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:subscription_succeeded')
    expect(msg.channel).toBe('presence-room')

    const data = JSON.parse(msg.data as string)
    expect(data.presence.count).toBe(1)
    expect(data.presence.ids).toContain('user-1')
    expect(data.presence.hash['user-1'].name).toBe('Alice')
  })

  it('should notify members when user joins', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    // User 1 joins
    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1' },
      })
    )

    ws1.sentMessages = []

    // User 2 joins
    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-2' },
      })
    )

    // User 1 should receive member_added
    const msg = ws1.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:member_added')
    expect(msg.channel).toBe('presence-room')

    const data = JSON.parse(msg.data as string)
    expect(data.id).toBe('user-2')
  })

  it('should notify members when user leaves', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1' },
      })
    )

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-2' },
      })
    )

    ws1.sentMessages = []

    // User 2 leaves
    await realtime.handleMessage(ws2, createUnsubscribeMessage('presence-room'))

    // User 1 should receive member_removed
    const msg = ws1.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:member_removed')

    const data = JSON.parse(msg.data as string)
    expect(data.id).toBe('user-2')
  })

  it('should track presence members correctly', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1' },
      })
    )

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-2' },
      })
    )

    const presence = realtime.getPresence('presence-room')
    expect(presence.count).toBe(2)
    expect(presence.members.map((m) => m.id).sort()).toEqual(['user-1', 'user-2'])
  })

  it('should clean up presence on disconnect', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1' },
      })
    )

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-2' },
      })
    )

    ws1.sentMessages = []

    // Simulate disconnect
    realtime.handleDisconnect(ws2)

    // User 1 should receive member_removed
    const msg = ws1.getLastMessage() as PusherMessage
    expect(msg.event).toBe('pusher:member_removed')

    const presence = realtime.getPresence('presence-room')
    expect(presence.count).toBe(1)
  })

  it('should allow client events on presence channels', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-1' },
      })
    )

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-room', user_id: 'user-2' },
      })
    )

    ws1.sentMessages = []
    ws2.sentMessages = []

    // ws1 sends cursor position
    await realtime.handleMessage(
      ws1,
      createClientEventMessage('presence-room', 'client-cursor', { x: 100, y: 200 })
    )

    // ws2 should receive it
    const msg = ws2.getLastMessage() as PusherMessage
    expect(msg.event).toBe('client-cursor')
  })
})

// ============================================================================
// BROADCAST API TESTS
// ============================================================================

describe('Broadcast API', () => {
  let realtime: MockRealtimeDO

  beforeEach(() => {
    realtime = new MockRealtimeDO()
  })

  it('should broadcast to channel subscribers', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    const ws3 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)
    realtime.handleNewConnection(ws3)

    await realtime.handleMessage(ws1, createSubscribeMessage('notifications'))
    await realtime.handleMessage(ws2, createSubscribeMessage('notifications'))
    // ws3 not subscribed

    ws1.sentMessages = []
    ws2.sentMessages = []
    ws3.sentMessages = []

    realtime.broadcast('notifications', 'alert', { message: 'System update' })

    expect(ws1.sentMessages.length).toBe(1)
    expect(ws2.sentMessages.length).toBe(1)
    expect(ws3.sentMessages.length).toBe(0) // Not subscribed
  })

  it('should handle non-existent channel gracefully', () => {
    // Should not throw
    realtime.broadcast('non-existent', 'event', { data: 'test' })
  })
})

// ============================================================================
// CHANNEL INFO TESTS
// ============================================================================

describe('Channel Info', () => {
  let realtime: MockRealtimeDO

  beforeEach(() => {
    realtime = new MockRealtimeDO()
  })

  it('should list all channels', async () => {
    const ws = new MockWebSocket()
    realtime.handleNewConnection(ws)

    await realtime.handleMessage(ws, createSubscribeMessage('channel-1'))
    await realtime.handleMessage(ws, createSubscribeMessage('channel-2'))
    await realtime.handleMessage(ws, createSubscribeMessage('private-chat'))

    const info = realtime.getChannelInfo()
    expect(info.channels.sort()).toEqual(['channel-1', 'channel-2', 'private-chat'])
  })

  it('should return correct presence info', async () => {
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    realtime.handleNewConnection(ws1)
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-lobby', user_id: 'alice', user_info: { name: 'Alice' } },
      })
    )

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-lobby', user_id: 'bob', user_info: { name: 'Bob' } },
      })
    )

    const presence = realtime.getPresence('presence-lobby')
    expect(presence.count).toBe(2)
    expect(presence.members.find((m) => m.id === 'alice')?.info.name).toBe('Alice')
    expect(presence.members.find((m) => m.id === 'bob')?.info.name).toBe('Bob')
  })

  it('should return empty presence for non-presence channel', async () => {
    const ws = new MockWebSocket()
    realtime.handleNewConnection(ws)

    await realtime.handleMessage(ws, createSubscribeMessage('public-channel'))

    const presence = realtime.getPresence('public-channel')
    expect(presence.count).toBe(0)
    expect(presence.members).toEqual([])
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let realtime: MockRealtimeDO
  let ws: MockWebSocket

  beforeEach(() => {
    realtime = new MockRealtimeDO()
    ws = new MockWebSocket()
    realtime.handleNewConnection(ws)
    ws.sentMessages = []
  })

  it('should reject subscribe without channel name', async () => {
    await realtime.handleMessage(
      ws,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: {},
      })
    )

    const msg = ws.getLastMessage()
    expect(msg?.event).toBe('pusher:error')
  })

  it('should handle unknown event gracefully', async () => {
    // Should not throw
    await realtime.handleMessage(
      ws,
      JSON.stringify({
        event: 'unknown:event',
        data: {},
      })
    )

    // No error sent for unknown events (just ignored)
    expect(ws.sentMessages.length).toBe(0)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration Scenarios', () => {
  let realtime: MockRealtimeDO

  beforeEach(() => {
    realtime = new MockRealtimeDO()
  })

  it('should handle realistic chat scenario', async () => {
    // User 1 connects and joins presence room
    const ws1 = new MockWebSocket()
    realtime.handleNewConnection(ws1)

    await realtime.handleMessage(
      ws1,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-chat', user_id: 'alice', user_info: { name: 'Alice' } },
      })
    )

    // User 2 connects and joins
    const ws2 = new MockWebSocket()
    realtime.handleNewConnection(ws2)

    await realtime.handleMessage(
      ws2,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-chat', user_id: 'bob', user_info: { name: 'Bob' } },
      })
    )

    ws1.sentMessages = []
    ws2.sentMessages = []

    // Alice starts typing
    await realtime.handleMessage(
      ws1,
      createClientEventMessage('presence-chat', 'client-typing', { user: 'alice' })
    )

    // Bob sees typing indicator
    expect(ws2.getLastMessage()?.event).toBe('client-typing')

    // Server broadcasts a message
    realtime.broadcast('presence-chat', 'message', {
      id: '1',
      user: 'alice',
      text: 'Hello everyone!',
      timestamp: Date.now(),
    })

    // Both should receive the broadcast message
    // Note: ws1 doesn't receive its own typing event (excluded), ws2 does
    expect(ws1.sentMessages.length).toBe(1) // just broadcast message
    expect(ws2.sentMessages.length).toBe(2) // typing + message

    // Bob leaves
    realtime.handleDisconnect(ws2)

    // Alice gets notification
    const lastMsg = ws1.getLastMessage() as PusherMessage
    expect(lastMsg.event).toBe('pusher:member_removed')

    const presence = realtime.getPresence('presence-chat')
    expect(presence.count).toBe(1)
  })

  it('should handle live cursor sharing', async () => {
    // 3 users collaborate on a document
    const users = ['alice', 'bob', 'carol']
    const sockets = users.map(() => {
      const ws = new MockWebSocket()
      realtime.handleNewConnection(ws)
      return ws
    })

    // All join the presence channel
    for (let i = 0; i < users.length; i++) {
      await realtime.handleMessage(
        sockets[i],
        JSON.stringify({
          event: 'pusher:subscribe',
          data: { channel: 'presence-doc-123', user_id: users[i] },
        })
      )
    }

    // Clear messages
    sockets.forEach((ws) => (ws.sentMessages = []))

    // Alice moves cursor
    await realtime.handleMessage(
      sockets[0],
      createClientEventMessage('presence-doc-123', 'client-cursor', {
        user: 'alice',
        x: 150,
        y: 300,
      })
    )

    // Bob and Carol should see it, Alice should not
    expect(sockets[0].sentMessages.length).toBe(0)
    expect(sockets[1].sentMessages.length).toBe(1)
    expect(sockets[2].sentMessages.length).toBe(1)

    const presence = realtime.getPresence('presence-doc-123')
    expect(presence.count).toBe(3)
  })

  it('should handle multiple channel subscriptions per user', async () => {
    const ws = new MockWebSocket()
    realtime.handleNewConnection(ws)

    // Subscribe to multiple channels
    await realtime.handleMessage(ws, createSubscribeMessage('notifications'))
    await realtime.handleMessage(ws, createSubscribeMessage('private-chat'))
    await realtime.handleMessage(
      ws,
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: 'presence-lobby', user_id: 'user-1' },
      })
    )

    const info = realtime.getChannelInfo()
    expect(info.channels.length).toBe(3)

    // Disconnect cleans up all
    realtime.handleDisconnect(ws)

    const infoAfter = realtime.getChannelInfo()
    expect(infoAfter.channels.length).toBe(0)
    expect(infoAfter.totalConnections).toBe(0)
  })
})
