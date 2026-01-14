/**
 * @dotdo/pusher Server SDK Tests
 *
 * Tests for server-side Pusher API:
 * - Event triggering
 * - Batch events
 * - Channel authentication
 * - Channel info retrieval
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PusherServer } from '../src/server'
import type { PusherServerOptions, BatchEvent } from '../src/server'

// ============================================================================
// MOCK DO FOR TESTING
// ============================================================================

class MockDOStub {
  broadcastCalls: Array<{ channel: string; event: string; data: unknown }> = []
  subscriberCount = 0
  presenceMembers: Array<{ id: string }> = []
  channels: string[] = []

  async broadcast(channel: string, event: string, data: unknown): Promise<{ ok: boolean }> {
    this.broadcastCalls.push({ channel, event, data })
    return { ok: true }
  }

  async getSubscriberCount(_channel: string): Promise<number> {
    return this.subscriberCount
  }

  async getPresence(_channel: string): Promise<{ members: Array<{ id: string }>; count: number }> {
    return { members: this.presenceMembers, count: this.presenceMembers.length }
  }

  async getChannelInfo(): Promise<{ channels: string[] }> {
    return { channels: this.channels }
  }
}

function createMockNamespace(stub: MockDOStub): DurableObjectNamespace {
  return {
    idFromName: (_name: string) => ({ toString: () => 'mock-id' }) as DurableObjectId,
    idFromString: (_id: string) => ({ toString: () => 'mock-id' }) as DurableObjectId,
    newUniqueId: () => ({ toString: () => 'mock-unique-id' }) as DurableObjectId,
    get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
    jurisdiction: (_jur: string) => createMockNamespace(stub),
  } as DurableObjectNamespace
}

// ============================================================================
// SERVER CREATION TESTS
// ============================================================================

describe('PusherServer Creation', () => {
  it('should create server with required options', () => {
    const server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
    })

    expect(server).toBeDefined()
  })

  it('should create server with custom host', () => {
    const server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      host: 'custom.host.com',
    })

    expect(server).toBeDefined()
  })

  it('should create server with cluster option', () => {
    const server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      cluster: 'eu',
    })

    expect(server).toBeDefined()
  })

  it('should create server with DO namespace', () => {
    const mockStub = new MockDOStub()
    const server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })

    expect(server).toBeDefined()
  })
})

// ============================================================================
// TRIGGER TESTS
// ============================================================================

describe('Trigger Events', () => {
  let server: PusherServer
  let mockStub: MockDOStub

  beforeEach(() => {
    mockStub = new MockDOStub()
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })
  })

  it('should trigger event on single channel', async () => {
    const result = await server.trigger('my-channel', 'my-event', { message: 'Hello!' })

    expect(result.ok).toBe(true)
    expect(mockStub.broadcastCalls.length).toBe(1)
    expect(mockStub.broadcastCalls[0]).toEqual({
      channel: 'my-channel',
      event: 'my-event',
      data: { message: 'Hello!' },
    })
  })

  it('should trigger event on multiple channels', async () => {
    const result = await server.trigger(['channel-1', 'channel-2'], 'update', { value: 42 })

    expect(result.ok).toBe(true)
    expect(mockStub.broadcastCalls.length).toBe(2)
    expect(mockStub.broadcastCalls[0].channel).toBe('channel-1')
    expect(mockStub.broadcastCalls[1].channel).toBe('channel-2')
  })

  it('should reject empty channel array', async () => {
    const result = await server.trigger([], 'my-event', {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('No channels')
  })

  it('should reject more than 100 channels', async () => {
    const channels = Array.from({ length: 101 }, (_, i) => `channel-${i}`)
    const result = await server.trigger(channels, 'my-event', {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('100')
  })

  it('should reject event name over 200 chars', async () => {
    const longEventName = 'e'.repeat(201)
    const result = await server.trigger('my-channel', longEventName, {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Event name too long')
  })
})

// ============================================================================
// BATCH TRIGGER TESTS
// ============================================================================

describe('Batch Trigger', () => {
  let server: PusherServer
  let mockStub: MockDOStub

  beforeEach(() => {
    mockStub = new MockDOStub()
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })
  })

  it('should trigger batch events', async () => {
    const batch: BatchEvent[] = [
      { channel: 'channel-1', name: 'event-1', data: { a: 1 } },
      { channel: 'channel-2', name: 'event-2', data: { b: 2 } },
    ]

    const result = await server.triggerBatch(batch)

    expect(result.ok).toBe(true)
    expect(mockStub.broadcastCalls.length).toBe(2)
  })

  it('should reject empty batch', async () => {
    const result = await server.triggerBatch([])

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Empty')
  })

  it('should reject batch over 10 events', async () => {
    const batch = Array.from({ length: 11 }, (_, i) => ({
      channel: `channel-${i}`,
      name: `event-${i}`,
      data: {},
    }))

    const result = await server.triggerBatch(batch)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('10')
  })
})

// ============================================================================
// CHANNEL INFO TESTS
// ============================================================================

describe('Channel Info', () => {
  let server: PusherServer
  let mockStub: MockDOStub

  beforeEach(() => {
    mockStub = new MockDOStub()
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })
  })

  it('should get channel info', async () => {
    mockStub.subscriberCount = 5

    const info = await server.getChannelInfo('my-channel')

    expect(info).not.toBeNull()
    expect(info?.occupied).toBe(true)
    expect(info?.subscription_count).toBe(5)
  })

  it('should get presence channel info with user count', async () => {
    mockStub.subscriberCount = 3
    mockStub.presenceMembers = [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }]

    const info = await server.getChannelInfo('presence-room')

    expect(info).not.toBeNull()
    expect(info?.occupied).toBe(true)
    expect(info?.subscription_count).toBe(3)
    expect(info?.user_count).toBe(3)
  })

  it('should show unoccupied channel', async () => {
    mockStub.subscriberCount = 0

    const info = await server.getChannelInfo('empty-channel')

    expect(info).not.toBeNull()
    expect(info?.occupied).toBe(false)
  })
})

// ============================================================================
// CHANNELS LIST TESTS
// ============================================================================

describe('Channels List', () => {
  let server: PusherServer
  let mockStub: MockDOStub

  beforeEach(() => {
    mockStub = new MockDOStub()
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })
  })

  it('should get all channels', async () => {
    mockStub.channels = ['channel-1', 'channel-2', 'private-chat']

    const result = await server.getChannels()

    expect(Object.keys(result.channels)).toHaveLength(3)
  })

  it('should filter channels by prefix', async () => {
    mockStub.channels = ['channel-1', 'channel-2', 'private-chat']

    const result = await server.getChannels('private-')

    expect(Object.keys(result.channels)).toHaveLength(1)
    expect(result.channels['private-chat']).toBeDefined()
  })
})

// ============================================================================
// PRESENCE USERS TESTS
// ============================================================================

describe('Presence Users', () => {
  let server: PusherServer
  let mockStub: MockDOStub

  beforeEach(() => {
    mockStub = new MockDOStub()
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: createMockNamespace(mockStub),
    })
  })

  it('should get presence users', async () => {
    mockStub.presenceMembers = [{ id: 'user-1' }, { id: 'user-2' }]

    const result = await server.getPresenceUsers('presence-room')

    expect(result.users).toHaveLength(2)
    expect(result.users[0].id).toBe('user-1')
  })

  it('should return empty for non-presence channel', async () => {
    const result = await server.getPresenceUsers('public-channel')

    expect(result.users).toHaveLength(0)
  })
})

// ============================================================================
// AUTHENTICATION TESTS
// ============================================================================

describe('Channel Authentication', () => {
  let server: PusherServer

  beforeEach(() => {
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
    })
  })

  it('should authorize private channel', () => {
    const auth = server.authorizeChannel('socket-123', 'private-channel')

    expect(auth.auth).toBeDefined()
    expect(auth.auth).toContain('test-key:')
    expect(auth.channel_data).toBeUndefined()
  })

  it('should authorize presence channel with user data', () => {
    const auth = server.authorizeChannel('socket-123', 'presence-room', {
      user_id: 'user-456',
      user_info: { name: 'Alice' },
    })

    expect(auth.auth).toBeDefined()
    expect(auth.channel_data).toBeDefined()

    const channelData = JSON.parse(auth.channel_data!)
    expect(channelData.user_id).toBe('user-456')
    expect(channelData.user_info.name).toBe('Alice')
  })

  it('should throw for presence channel without user data', () => {
    expect(() => {
      server.authorizeChannel('socket-123', 'presence-room')
    }).toThrow('Presence channels require user data')
  })
})

// ============================================================================
// USER AUTHENTICATION TESTS
// ============================================================================

describe('User Authentication', () => {
  let server: PusherServer

  beforeEach(() => {
    server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
    })
  })

  it('should authenticate user', () => {
    const auth = server.authenticateUser('socket-123', {
      id: 'user-456',
      user_info: { name: 'Bob' },
    })

    expect(auth.auth).toBeDefined()
    expect(auth.user_data).toBeDefined()

    const userData = JSON.parse(auth.user_data)
    expect(userData.id).toBe('user-456')
    expect(userData.user_info.name).toBe('Bob')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('should handle DO errors gracefully', async () => {
    const errorStub = {
      broadcast: async () => {
        throw new Error('DO unavailable')
      },
    }

    const namespace = {
      idFromName: () => ({ toString: () => 'mock-id' }) as DurableObjectId,
      get: () => errorStub as unknown as DurableObjectStub,
    } as DurableObjectNamespace

    const server = new PusherServer({
      appId: 'test-app',
      key: 'test-key',
      secret: 'test-secret',
      doNamespace: namespace,
    })

    const result = await server.trigger('channel', 'event', {})

    expect(result.ok).toBe(false)
    expect(result.error).toContain('DO unavailable')
  })
})
