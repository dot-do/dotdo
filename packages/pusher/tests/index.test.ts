/**
 * @dotdo/pusher - Pusher SDK compat tests
 *
 * Tests for pusher-js API compatibility backed by in-memory pub/sub:
 * - Client creation and connection
 * - Channel subscription/unsubscription
 * - Event binding and triggering
 * - Private channels with client events
 * - Presence channels with member tracking
 * - Connection state management
 *
 * @see https://pusher.com/docs/channels/using_channels/client-api-overview/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  PusherOptions,
  Connection,
  Channel,
  PrivateChannel,
  PresenceChannel,
  PresenceMember,
  Members,
  StateChange,
} from '../src'
import {
  Pusher,
  createPusher,
  _clearAll,
  isPrivateChannel,
  isPresenceChannel,
  PusherError,
  AuthError,
  SubscriptionError,
} from '../src'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('createPusher', () => {
  beforeEach(() => {
    _clearAll()
  })

  afterEach(() => {
    _clearAll()
  })

  it('should create client with key only', async () => {
    const pusher = createPusher('test-key')
    expect(pusher).toBeDefined()
    expect(pusher.key).toBe('test-key')
    // Wait for connection
    await new Promise((r) => setTimeout(r, 50))
    expect(pusher.connection.state).toBe('connected')
    pusher.disconnect()
  })

  it('should create client with options', async () => {
    const pusher = createPusher('test-key', {
      cluster: 'eu',
      forceTLS: true,
    })
    expect(pusher).toBeDefined()
    expect(pusher.config.cluster).toBe('eu')
    expect(pusher.config.forceTLS).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    pusher.disconnect()
  })

  it('should create client without auto-connect when disableStats is true', () => {
    const pusher = createPusher('test-key', { disableStats: true })
    expect(pusher.connection.state).toBe('initialized')
    pusher.disconnect()
  })
})

describe('Pusher constructor', () => {
  beforeEach(() => {
    _clearAll()
  })

  afterEach(() => {
    _clearAll()
  })

  it('should create with new Pusher(key)', async () => {
    const pusher = new Pusher('test-key')
    expect(pusher).toBeDefined()
    expect(pusher.key).toBe('test-key')
    await new Promise((r) => setTimeout(r, 50))
    pusher.disconnect()
  })

  it('should create with new Pusher(key, options)', async () => {
    const pusher = new Pusher('test-key', { cluster: 'ap1' })
    expect(pusher).toBeDefined()
    expect(pusher.config.cluster).toBe('ap1')
    await new Promise((r) => setTimeout(r, 50))
    pusher.disconnect()
  })
})

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('Connection', () => {
  let pusher: Pusher

  beforeEach(() => {
    _clearAll()
    pusher = new Pusher('test-key', { disableStats: true })
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  describe('state management', () => {
    it('should start in initialized state', () => {
      expect(pusher.connection.state).toBe('initialized')
    })

    it('should transition to connecting then connected', async () => {
      const states: string[] = []

      pusher.connection.bind('state_change', (data: StateChange) => {
        states.push(data.current)
      })

      pusher.connect()

      await new Promise((r) => setTimeout(r, 50))

      expect(states).toContain('connecting')
      expect(states).toContain('connected')
      expect(pusher.connection.state).toBe('connected')
    })

    it('should have socket_id when connected', async () => {
      expect(pusher.connection.socket_id).toBeNull()

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(pusher.connection.socket_id).not.toBeNull()
      expect(typeof pusher.connection.socket_id).toBe('string')
    })

    it('should emit connected event with socket_id', async () => {
      let connectedData: { socket_id: string } | undefined

      pusher.connection.bind('connected', (data: { socket_id: string }) => {
        connectedData = data
      })

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(connectedData).toBeDefined()
      expect(connectedData!.socket_id).toBe(pusher.connection.socket_id)
    })

    it('should transition to disconnected on disconnect', async () => {
      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(pusher.connection.state).toBe('connected')

      pusher.disconnect()

      expect(pusher.connection.state).toBe('disconnected')
    })
  })

  describe('event binding', () => {
    it('should bind to connection events', async () => {
      const callback = vi.fn()
      pusher.connection.bind('connected', callback)

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(callback).toHaveBeenCalled()
    })

    it('should unbind from connection events', async () => {
      const callback = vi.fn()
      pusher.connection.bind('connected', callback)
      pusher.connection.unbind('connected', callback)

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(callback).not.toHaveBeenCalled()
    })

    it('should bind_global to all events', async () => {
      const events: string[] = []
      pusher.connection.bind_global((event: string) => {
        events.push(event)
      })

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(events).toContain('state_change')
      expect(events).toContain('connecting')
      expect(events).toContain('connected')
    })

    it('should unbind_global', async () => {
      const callback = vi.fn()
      pusher.connection.bind_global(callback)
      pusher.connection.unbind_global(callback)

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('connect/disconnect', () => {
    it('should not reconnect when already connected', async () => {
      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      const socketId = pusher.connection.socket_id

      pusher.connect() // Should be no-op
      await new Promise((r) => setTimeout(r, 50))

      expect(pusher.connection.socket_id).toBe(socketId)
    })

    it('should be able to reconnect after disconnect', async () => {
      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      const oldSocketId = pusher.connection.socket_id

      pusher.disconnect()
      expect(pusher.connection.state).toBe('disconnected')

      pusher.connect()
      await new Promise((r) => setTimeout(r, 50))

      expect(pusher.connection.state).toBe('connected')
      expect(pusher.connection.socket_id).not.toBe(oldSocketId)
    })
  })
})

// ============================================================================
// CHANNEL TESTS
// ============================================================================

describe('Channels', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  describe('subscribe/unsubscribe', () => {
    it('should subscribe to a channel', () => {
      const channel = pusher.subscribe('my-channel')
      expect(channel).toBeDefined()
      expect(channel.name).toBe('my-channel')
    })

    it('should return same channel on duplicate subscribe', () => {
      const channel1 = pusher.subscribe('my-channel')
      const channel2 = pusher.subscribe('my-channel')
      expect(channel1).toBe(channel2)
    })

    it('should set subscribed to true after subscription', async () => {
      const channel = pusher.subscribe('my-channel')
      await new Promise((r) => setTimeout(r, 50))
      expect(channel.subscribed).toBe(true)
    })

    it('should emit pusher:subscription_succeeded', async () => {
      const channel = pusher.subscribe('my-channel')
      const callback = vi.fn()

      channel.bind('pusher:subscription_succeeded', callback)

      await new Promise((r) => setTimeout(r, 50))
      expect(callback).toHaveBeenCalled()
    })

    it('should unsubscribe from channel', async () => {
      const channel = pusher.subscribe('my-channel')
      await new Promise((r) => setTimeout(r, 50))

      pusher.unsubscribe('my-channel')

      expect(channel.subscribed).toBe(false)
      expect(pusher.channel('my-channel')).toBeNull()
    })

    it('should unsubscribe via channel.unsubscribe()', async () => {
      const channel = pusher.subscribe('my-channel')
      await new Promise((r) => setTimeout(r, 50))

      channel.unsubscribe()

      expect(channel.subscribed).toBe(false)
    })

    it('should unsubscribeAll', async () => {
      pusher.subscribe('channel-1')
      pusher.subscribe('channel-2')
      pusher.subscribe('channel-3')
      await new Promise((r) => setTimeout(r, 50))

      expect(pusher.allChannels().length).toBe(3)

      pusher.unsubscribeAll()

      expect(pusher.allChannels().length).toBe(0)
    })
  })

  describe('channel()', () => {
    it('should return channel by name', () => {
      pusher.subscribe('my-channel')
      const channel = pusher.channel('my-channel')
      expect(channel).not.toBeNull()
      expect(channel!.name).toBe('my-channel')
    })

    it('should return null for non-existent channel', () => {
      const channel = pusher.channel('non-existent')
      expect(channel).toBeNull()
    })
  })

  describe('allChannels()', () => {
    it('should return all subscribed channels', async () => {
      pusher.subscribe('channel-1')
      pusher.subscribe('channel-2')
      await new Promise((r) => setTimeout(r, 50))

      const channels = pusher.allChannels()
      expect(channels.length).toBe(2)
      expect(channels.map((c) => c.name).sort()).toEqual(['channel-1', 'channel-2'])
    })

    it('should return empty array when no channels', () => {
      const channels = pusher.allChannels()
      expect(channels).toEqual([])
    })
  })

  describe('event binding', () => {
    it('should bind to channel events', async () => {
      const channel = pusher.subscribe('my-channel')
      const callback = vi.fn()

      channel.bind('my-event', callback)

      // Simulate event delivery (via another client)
      const pusher2 = new Pusher('test-key')
      await new Promise((r) => setTimeout(r, 50))
      const channel2 = pusher2.subscribe('my-channel')
      await new Promise((r) => setTimeout(r, 50))

      // In a real scenario, server would deliver events
      // For testing, we manually trigger
      ;(channel as any)._emit('my-event', { message: 'hello' })

      expect(callback).toHaveBeenCalledWith({ message: 'hello' })

      pusher2.disconnect()
    })

    it('should unbind from channel events', () => {
      const channel = pusher.subscribe('my-channel')
      const callback = vi.fn()

      channel.bind('my-event', callback)
      channel.unbind('my-event', callback)
      ;(channel as any)._emit('my-event', { message: 'hello' })

      expect(callback).not.toHaveBeenCalled()
    })

    it('should unbind all handlers for an event', () => {
      const channel = pusher.subscribe('my-channel')
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      channel.bind('my-event', callback1)
      channel.bind('my-event', callback2)
      channel.unbind('my-event')
      ;(channel as any)._emit('my-event', { message: 'hello' })

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).not.toHaveBeenCalled()
    })

    it('should bind_global to all channel events', () => {
      const channel = pusher.subscribe('my-channel')
      const events: string[] = []

      channel.bind_global((event: string) => {
        events.push(event)
      })
      ;(channel as any)._emit('event-1', {})
      ;(channel as any)._emit('event-2', {})

      expect(events).toContain('event-1')
      expect(events).toContain('event-2')
    })
  })
})

// ============================================================================
// PRIVATE CHANNEL TESTS
// ============================================================================

describe('Private Channels', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should subscribe to private channel', async () => {
    const channel = pusher.subscribe('private-my-channel')
    await new Promise((r) => setTimeout(r, 50))

    expect(channel).toBeDefined()
    expect(channel.name).toBe('private-my-channel')
    expect(channel.subscribed).toBe(true)
  })

  it('should identify as private channel', () => {
    const channel = pusher.subscribe('private-my-channel')
    expect(isPrivateChannel(channel)).toBe(true)
    expect(isPresenceChannel(channel)).toBe(false)
  })

  it('should trigger client events on private channel', async () => {
    const channel = pusher.subscribe('private-my-channel')
    await new Promise((r) => setTimeout(r, 50))

    const result = channel.trigger('client-my-event', { data: 'test' })
    expect(result).toBe(true)
  })

  it('should require client- prefix for client events', async () => {
    const channel = pusher.subscribe('private-my-channel')
    await new Promise((r) => setTimeout(r, 50))

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = channel.trigger('my-event', { data: 'test' })

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('should not trigger client events when unsubscribed', async () => {
    const channel = pusher.subscribe('private-my-channel')
    await new Promise((r) => setTimeout(r, 50))

    channel.unsubscribe()

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = channel.trigger('client-my-event', { data: 'test' })

    expect(result).toBe(false)

    consoleSpy.mockRestore()
  })

  it('should deliver client events to other subscribers', async () => {
    // First client
    const channel1 = pusher.subscribe('private-shared-channel')
    await new Promise((r) => setTimeout(r, 50))

    // Second client
    const pusher2 = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
    const channel2 = pusher2.subscribe('private-shared-channel')
    await new Promise((r) => setTimeout(r, 50))

    // Bind event on second client
    const callback = vi.fn()
    channel2.bind('client-test-event', callback)

    // Trigger from first client
    channel1.trigger('client-test-event', { message: 'hello' })

    await new Promise((r) => setTimeout(r, 50))

    expect(callback).toHaveBeenCalledWith({ message: 'hello' })

    pusher2.disconnect()
  })
})

// ============================================================================
// PRESENCE CHANNEL TESTS
// ============================================================================

describe('Presence Channels', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should subscribe to presence channel', async () => {
    const channel = pusher.subscribe('presence-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    expect(channel).toBeDefined()
    expect(channel.name).toBe('presence-room')
    expect(channel.subscribed).toBe(true)
  })

  it('should identify as presence channel', () => {
    const channel = pusher.subscribe('presence-room')
    expect(isPresenceChannel(channel)).toBe(true)
    expect(isPrivateChannel(channel)).toBe(true) // Presence is also private
  })

  it('should have members collection', async () => {
    const channel = pusher.subscribe('presence-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    expect(channel.members).toBeDefined()
    expect(typeof channel.members.count).toBe('number')
  })

  it('should have me in members', async () => {
    const channel = pusher.subscribe('presence-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    expect(channel.members.me).not.toBeNull()
    expect(channel.members.me!.id).toBeDefined()
  })

  it('should emit pusher:subscription_succeeded with members', async () => {
    const channel = pusher.subscribe('presence-room') as PresenceChannel

    let receivedMembers: Members | undefined
    channel.bind('pusher:subscription_succeeded', (members: Members) => {
      receivedMembers = members
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(receivedMembers).toBeDefined()
    expect(receivedMembers!.count).toBeGreaterThan(0)
  })

  describe('members', () => {
    it('should count members', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      expect(channel.members.count).toBe(1) // Just the current user
    })

    it('should iterate over members with each()', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const members: PresenceMember[] = []
      channel.members.each((member) => {
        members.push(member)
      })

      expect(members.length).toBe(channel.members.count)
    })

    it('should get member by ID', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const me = channel.members.me!
      const member = channel.members.get(me.id)

      expect(member).not.toBeNull()
      expect(member!.id).toBe(me.id)
    })

    it('should return null for non-existent member', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const member = channel.members.get('non-existent-id')
      expect(member).toBeNull()
    })

    it('should convert to array', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const members = channel.members.toArray()
      expect(Array.isArray(members)).toBe(true)
      expect(members.length).toBe(channel.members.count)
    })
  })

  describe('member events', () => {
    it('should emit pusher:member_added when another user joins', async () => {
      const channel1 = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const callback = vi.fn()
      channel1.bind('pusher:member_added', callback)

      // Second client joins
      const pusher2 = new Pusher('test-key')
      await new Promise((r) => setTimeout(r, 50))
      pusher2.subscribe('presence-room')
      await new Promise((r) => setTimeout(r, 100))

      expect(callback).toHaveBeenCalled()
      const member = callback.mock.calls[0][0] as PresenceMember
      expect(member.id).toBeDefined()

      pusher2.disconnect()
    })

    it('should emit pusher:member_removed when user leaves', async () => {
      const channel1 = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      const callback = vi.fn()
      channel1.bind('pusher:member_removed', callback)

      // Second client joins and leaves
      const pusher2 = new Pusher('test-key')
      await new Promise((r) => setTimeout(r, 50))
      pusher2.subscribe('presence-room')
      await new Promise((r) => setTimeout(r, 50))

      pusher2.disconnect()
      await new Promise((r) => setTimeout(r, 50))

      expect(callback).toHaveBeenCalled()
    })

    it('should update members.count when members change', async () => {
      const channel1 = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((r) => setTimeout(r, 50))

      expect(channel1.members.count).toBe(1)

      // Second client joins
      const pusher2 = new Pusher('test-key')
      await new Promise((r) => setTimeout(r, 50))
      pusher2.subscribe('presence-room')
      await new Promise((r) => setTimeout(r, 100))

      expect(channel1.members.count).toBe(2)

      pusher2.disconnect()
      await new Promise((r) => setTimeout(r, 100))

      expect(channel1.members.count).toBe(1)
    })
  })

  it('should trigger client events on presence channel', async () => {
    const channel = pusher.subscribe('presence-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    const result = channel.trigger('client-message', { text: 'hello' })
    expect(result).toBe(true)
  })
})

// ============================================================================
// PUBLIC CHANNEL RESTRICTIONS
// ============================================================================

describe('Public Channel Restrictions', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should not allow client events on public channels', async () => {
    const channel = pusher.subscribe('public-channel')
    await new Promise((r) => setTimeout(r, 50))

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = channel.trigger('client-event', { data: 'test' })

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})

// ============================================================================
// GLOBAL EVENT BINDING
// ============================================================================

describe('Global Event Binding', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should bind to events on pusher instance', async () => {
    const callback = vi.fn()
    pusher.bind('test-event', callback)

    // Subscribe to a channel
    const channel = pusher.subscribe('my-channel')
    await new Promise((r) => setTimeout(r, 50))

    // Events would be delivered via _deliverEvent
    // which also emits to global listeners
    ;(pusher as any)._impl._emit('test-event', { channel: 'my-channel', data: {} })

    expect(callback).toHaveBeenCalled()
  })

  it('should unbind from events on pusher instance', () => {
    const callback = vi.fn()
    pusher.bind('test-event', callback)
    pusher.unbind('test-event', callback)
    ;(pusher as any)._impl._emit('test-event', {})

    expect(callback).not.toHaveBeenCalled()
  })

  it('should bind_global on pusher instance', () => {
    const events: string[] = []
    pusher.bind_global((event: string) => {
      events.push(event)
    })
    ;(pusher as any)._impl._emit('event-1', {})
    ;(pusher as any)._impl._emit('event-2', {})

    expect(events).toContain('event-1')
    expect(events).toContain('event-2')
  })
})

// ============================================================================
// USER DATA TESTS
// ============================================================================

describe('User', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should have user property', () => {
    expect(pusher.user).toBeDefined()
  })

  it('should sign in user', async () => {
    pusher.signin()

    expect(pusher.user.id).toBeDefined()
  })

  it('should bind to user events', () => {
    const callback = vi.fn()
    pusher.user.bind('pusher:signin_success', callback)

    pusher.signin()

    expect(callback).toHaveBeenCalled()
  })

  it('should have watchlist', () => {
    expect(pusher.user.watchlist).toBeDefined()
    expect(typeof pusher.user.watchlist.bind).toBe('function')
    expect(typeof pusher.user.watchlist.unbind).toBe('function')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('should create PusherError', () => {
    const error = new PusherError('Test error')
    expect(error.message).toBe('Test error')
    expect(error.type).toBe('PusherError')
    expect(error.name).toBe('PusherError')
  })

  it('should create AuthError with status', () => {
    const error = new AuthError('Auth failed', 403)
    expect(error.message).toBe('Auth failed')
    expect(error.type).toBe('AuthError')
    expect(error.status).toBe(403)
  })

  it('should create SubscriptionError', () => {
    const error = new SubscriptionError('Subscription failed', 500)
    expect(error.message).toBe('Subscription failed')
    expect(error.type).toBe('SubscriptionError')
    expect(error.status).toBe(500)
  })
})

// ============================================================================
// TYPE GUARDS TESTS
// ============================================================================

describe('Type Guards', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('isPrivateChannel should return true for private channels', () => {
    const channel = pusher.subscribe('private-test')
    expect(isPrivateChannel(channel)).toBe(true)
  })

  it('isPrivateChannel should return false for public channels', () => {
    const channel = pusher.subscribe('public-test')
    expect(isPrivateChannel(channel)).toBe(false)
  })

  it('isPresenceChannel should return true for presence channels', () => {
    const channel = pusher.subscribe('presence-test')
    expect(isPresenceChannel(channel)).toBe(true)
  })

  it('isPresenceChannel should return false for private channels', () => {
    const channel = pusher.subscribe('private-test')
    expect(isPresenceChannel(channel)).toBe(false)
  })
})

// ============================================================================
// SEND EVENT TESTS
// ============================================================================

describe('send_event', () => {
  let pusher: Pusher

  beforeEach(async () => {
    _clearAll()
    pusher = new Pusher('test-key')
    await new Promise((r) => setTimeout(r, 50))
  })

  afterEach(() => {
    pusher.disconnect()
    _clearAll()
  })

  it('should send event when connected', () => {
    const result = pusher.send_event('test-event', { data: 'test' }, 'my-channel')
    expect(result).toBe(true)
  })

  it('should not send event when disconnected', () => {
    pusher.disconnect()
    const result = pusher.send_event('test-event', { data: 'test' }, 'my-channel')
    expect(result).toBe(false)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  beforeEach(() => {
    _clearAll()
  })

  afterEach(() => {
    _clearAll()
  })

  it('should work with realistic chat scenario', async () => {
    // User 1 joins
    const pusher1 = new Pusher('app-key')
    await new Promise((r) => setTimeout(r, 50))

    const chatRoom = pusher1.subscribe('presence-chat-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    const messages: Array<{ user: string; text: string }> = []
    chatRoom.bind('client-message', (data: { user: string; text: string }) => {
      messages.push(data)
    })

    // User 2 joins
    const pusher2 = new Pusher('app-key')
    await new Promise((r) => setTimeout(r, 50))

    const chatRoom2 = pusher2.subscribe('presence-chat-room') as PresenceChannel
    await new Promise((r) => setTimeout(r, 50))

    // User 2 sends message
    chatRoom2.trigger('client-message', { user: 'User2', text: 'Hello!' })
    await new Promise((r) => setTimeout(r, 50))

    // User 1 should receive it
    expect(messages.length).toBe(1)
    expect(messages[0].text).toBe('Hello!')

    pusher1.disconnect()
    pusher2.disconnect()
  })

  it('should work with live updates scenario', async () => {
    // Client
    const client = new Pusher('app-key')
    await new Promise((r) => setTimeout(r, 50))

    const channel = client.subscribe('updates')
    await new Promise((r) => setTimeout(r, 50))

    const updates: unknown[] = []
    channel.bind('stock-update', (data: unknown) => {
      updates.push(data)
    })

    // Note: In real implementation, server would push to all clients via
    // PusherServer.trigger(). For unit testing the client, we manually deliver.
    ;(channel as any)._emit('stock-update', { symbol: 'AAPL', price: 150.5 })

    expect(updates.length).toBe(1)
    expect(updates[0]).toEqual({ symbol: 'AAPL', price: 150.5 })

    client.disconnect()
  })

  it('should handle multiple channels per client', async () => {
    const pusher = new Pusher('app-key')
    await new Promise((r) => setTimeout(r, 50))

    const channel1 = pusher.subscribe('channel-1')
    const channel2 = pusher.subscribe('private-channel-2')
    const channel3 = pusher.subscribe('presence-channel-3')

    await new Promise((r) => setTimeout(r, 100))

    expect(pusher.allChannels().length).toBe(3)
    expect(channel1.subscribed).toBe(true)
    expect(channel2.subscribed).toBe(true)
    expect(channel3.subscribed).toBe(true)

    pusher.disconnect()
  })

  it('should auto-subscribe pending channels on connect', async () => {
    const pusher = new Pusher('app-key', { disableStats: true })

    // Subscribe before connected
    const channel = pusher.subscribe('my-channel')
    expect(channel.subscribed).toBe(false)

    // Connect
    pusher.connect()
    await new Promise((r) => setTimeout(r, 100))

    // Should now be subscribed
    expect(channel.subscribed).toBe(true)

    pusher.disconnect()
  })
})
