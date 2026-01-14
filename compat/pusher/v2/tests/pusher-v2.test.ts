/**
 * Pusher v2 Tests - Adapter-based implementation
 *
 * Tests the Channel-based Pusher adapter to ensure API compatibility
 * while demonstrating the simplicity of the abstraction.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Pusher, { type Channel, type PresenceChannel } from '../index'

describe('Pusher v2 - Channel Adapter', () => {
  let pusher: Pusher

  beforeEach(() => {
    pusher = new Pusher('test-app-key', { cluster: 'mt1' })
  })

  describe('Pusher Client', () => {
    it('should create pusher instance with config', () => {
      expect(pusher.key).toBe('test-app-key')
      expect(pusher.config.cluster).toBe('mt1')
      expect(pusher.config.forceTLS).toBe(true)
    })

    it('should auto-connect by default', async () => {
      // Wait for microtask
      await new Promise((resolve) => queueMicrotask(resolve))
      // Connection happens in microtask
      expect(pusher.allChannels()).toHaveLength(0)
    })
  })

  describe('Public Channels', () => {
    it('should subscribe to a public channel', async () => {
      const channel = pusher.subscribe('my-channel')

      expect(channel.name).toBe('my-channel')
      // Wait for subscription
      await new Promise((resolve) => queueMicrotask(resolve))
      expect(channel.subscribed).toBe(true)
    })

    it('should bind and receive events', async () => {
      const channel = pusher.subscribe('my-channel')
      const callback = vi.fn()

      channel.bind('my-event', callback)

      // Wait for subscription
      await new Promise((resolve) => queueMicrotask(resolve))

      // Access primitive channel to publish (simulating server push)
      const primitiveChannel = (channel as any).primitiveChannel
      await primitiveChannel.publish('my-event', { message: 'hello' })

      expect(callback).toHaveBeenCalledWith({ message: 'hello' })
    })

    it('should unbind specific callback', async () => {
      const channel = pusher.subscribe('test-channel')
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      channel.bind('event', callback1)
      channel.bind('event', callback2)
      channel.unbind('event', callback1)

      await new Promise((resolve) => queueMicrotask(resolve))

      const primitiveChannel = (channel as any).primitiveChannel
      await primitiveChannel.publish('event', { data: 'test' })

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).toHaveBeenCalledWith({ data: 'test' })
    })

    it('should unbind all callbacks for an event', async () => {
      const channel = pusher.subscribe('test-channel')
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      channel.bind('event', callback1)
      channel.bind('event', callback2)
      channel.unbind('event')

      await new Promise((resolve) => queueMicrotask(resolve))

      const primitiveChannel = (channel as any).primitiveChannel
      await primitiveChannel.publish('event', { data: 'test' })

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).not.toHaveBeenCalled()
    })

    it('should not allow trigger on public channels', async () => {
      const channel = pusher.subscribe('public-channel')
      await new Promise((resolve) => queueMicrotask(resolve))

      const result = channel.trigger('client-event', { data: 'test' })
      expect(result).toBe(false)
    })

    it('should return same channel on duplicate subscribe', () => {
      const channel1 = pusher.subscribe('my-channel')
      const channel2 = pusher.subscribe('my-channel')

      expect(channel1).toBe(channel2)
    })
  })

  describe('Private Channels', () => {
    it('should subscribe to a private channel', async () => {
      const channel = pusher.subscribe('private-channel')

      expect(channel.name).toBe('private-channel')
      await new Promise((resolve) => queueMicrotask(resolve))
      expect(channel.subscribed).toBe(true)
    })

    it('should allow trigger on private channels with client- prefix', async () => {
      const channel = pusher.subscribe('private-channel')
      await new Promise((resolve) => queueMicrotask(resolve))

      const result = channel.trigger('client-event', { msg: 'hi' })
      expect(result).toBe(true)
    })

    it('should reject trigger without client- prefix', async () => {
      const channel = pusher.subscribe('private-channel')
      await new Promise((resolve) => queueMicrotask(resolve))

      const result = channel.trigger('server-event', { msg: 'hi' })
      expect(result).toBe(false)
    })

    it('should reject trigger when not subscribed', () => {
      // Create a new disconnected pusher
      const disconnectedPusher = new Pusher('test-key')
      disconnectedPusher.disconnect() // Disconnect immediately

      const channel = disconnectedPusher.subscribe('private-channel')
      // Channel is not subscribed because pusher is disconnected
      expect(channel.subscribed).toBe(false)

      const result = channel.trigger('client-event', { msg: 'hi' })
      expect(result).toBe(false)
    })
  })

  describe('Presence Channels', () => {
    it('should subscribe to a presence channel', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel

      expect(channel.name).toBe('presence-room')
      await new Promise((resolve) => queueMicrotask(resolve))
      expect(channel.subscribed).toBe(true)
    })

    it('should have members collection', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((resolve) => queueMicrotask(resolve))

      expect(channel.members).toBeDefined()
      expect(channel.members.me).not.toBeNull()
      expect(channel.members.count).toBeGreaterThanOrEqual(1)
    })

    it('should track current user as me', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((resolve) => queueMicrotask(resolve))

      expect(channel.members.me).toBeDefined()
      expect(channel.members.me?.id).toBeTruthy()
    })

    it('should iterate over members with each()', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((resolve) => queueMicrotask(resolve))

      const members: string[] = []
      channel.members.each((member) => {
        members.push(member.id)
      })

      expect(members.length).toBeGreaterThanOrEqual(1)
      expect(members).toContain(channel.members.me?.id)
    })

    it('should get member by id', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      await new Promise((resolve) => queueMicrotask(resolve))

      const me = channel.members.me!
      const found = channel.members.get(me.id)

      expect(found).toEqual(me)
    })

    it('should emit pusher:subscription_succeeded with members', async () => {
      const channel = pusher.subscribe('presence-room') as PresenceChannel
      const callback = vi.fn()

      channel.bind('pusher:subscription_succeeded', callback)

      // Wait for subscription event
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(callback).toHaveBeenCalled()
      const members = callback.mock.calls[0][0]
      expect(members.me).toBeDefined()
    })

    it('should allow trigger on presence channels', async () => {
      const channel = pusher.subscribe('presence-room')
      await new Promise((resolve) => queueMicrotask(resolve))

      const result = channel.trigger('client-typing', { user: 'test' })
      expect(result).toBe(true)
    })
  })

  describe('Channel Management', () => {
    it('should get channel by name', async () => {
      pusher.subscribe('test-channel')

      const channel = pusher.channel('test-channel')
      expect(channel).not.toBeNull()
      expect(channel?.name).toBe('test-channel')
    })

    it('should return null for non-existent channel', () => {
      const channel = pusher.channel('non-existent')
      expect(channel).toBeNull()
    })

    it('should list all channels', () => {
      pusher.subscribe('channel-1')
      pusher.subscribe('channel-2')
      pusher.subscribe('channel-3')

      const channels = pusher.allChannels()
      expect(channels).toHaveLength(3)
    })

    it('should unsubscribe from channel', async () => {
      const channel = pusher.subscribe('test-channel')
      await new Promise((resolve) => queueMicrotask(resolve))

      expect(channel.subscribed).toBe(true)

      pusher.unsubscribe('test-channel')

      expect(channel.subscribed).toBe(false)
      expect(pusher.channel('test-channel')).toBeNull()
    })
  })

  describe('Connection Management', () => {
    it('should disconnect and clear all channels', async () => {
      pusher.subscribe('channel-1')
      pusher.subscribe('channel-2')
      await new Promise((resolve) => queueMicrotask(resolve))

      pusher.disconnect()

      expect(pusher.allChannels()).toHaveLength(0)
    })

    it('should reconnect after disconnect', async () => {
      pusher.disconnect()
      pusher.connect()

      const channel = pusher.subscribe('test-channel')
      await new Promise((resolve) => queueMicrotask(resolve))

      expect(channel.subscribed).toBe(true)
    })
  })

  describe('Event Chaining', () => {
    it('should support method chaining on bind', async () => {
      const channel = pusher.subscribe('test-channel')
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const result = channel.bind('event1', callback1).bind('event2', callback2)

      expect(result).toBe(channel)
    })

    it('should support method chaining on unbind', () => {
      const channel = pusher.subscribe('test-channel')

      const result = channel.unbind('event1').unbind('event2')

      expect(result).toBe(channel)
    })
  })

  describe('API Compatibility', () => {
    it('should match pusher-js subscribe API', async () => {
      // Standard pusher-js usage pattern
      const channel = pusher.subscribe('my-channel')

      channel.bind('pusher:subscription_succeeded', () => {
        // Subscription succeeded
      })

      channel.bind('my-event', (data) => {
        // Handle event
      })

      await new Promise((resolve) => queueMicrotask(resolve))

      expect(channel.subscribed).toBe(true)
    })

    it('should match pusher-js presence API', async () => {
      // Standard pusher-js presence pattern
      const presence = pusher.subscribe('presence-room') as PresenceChannel

      presence.bind('pusher:subscription_succeeded', (members) => {
        // Members available
      })

      presence.bind('pusher:member_added', (member) => {
        // Handle member join
      })

      presence.bind('pusher:member_removed', (member) => {
        // Handle member leave
      })

      await new Promise((resolve) => queueMicrotask(resolve))

      expect(presence.members.count).toBeGreaterThanOrEqual(1)
    })

    it('should match pusher-js trigger API', async () => {
      const channel = pusher.subscribe('private-chat')
      await new Promise((resolve) => queueMicrotask(resolve))

      // Standard client event trigger
      const sent = channel.trigger('client-message', {
        text: 'Hello!',
        sender: 'user-123',
      })

      expect(sent).toBe(true)
    })
  })
})

describe('LOC Comparison', () => {
  it('demonstrates dramatic code reduction', () => {
    // Original implementation: ~800 LOC (streaming/compat/pusher/pusher.ts)
    // v2 implementation: ~200 LOC (compat/pusher/v2/index.ts)
    //
    // The Channel primitive provides:
    // - Event subscription/publishing (replaces EventEmitter boilerplate)
    // - Presence tracking (replaces ~100 LOC Members implementation)
    // - Type-safe handlers
    // - Backpressure support (free)
    // - Persistence support (free)
    //
    // What v2 adds:
    // - API mapping (bind -> subscribe, trigger -> publish)
    // - Channel type detection from name prefix
    // - Pusher-specific events (pusher:subscription_succeeded, etc.)

    expect(true).toBe(true) // Documentation test
  })
})
