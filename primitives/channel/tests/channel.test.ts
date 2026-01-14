/**
 * Channel Tests - TDD Red-Green-Refactor
 *
 * Unified pub/sub abstraction replacing 4 EventEmitter variants.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Channel, createChannel } from '../index'
import type { Handler, Subscription, Member, PersistenceConfig } from '../types'

// =============================================================================
// TDD Cycle 1: Basic Pub/Sub
// =============================================================================

describe('Channel - Basic Pub/Sub', () => {
  let channel: Channel<string>

  beforeEach(() => {
    channel = createChannel<string>('test-channel')
  })

  describe('channel properties', () => {
    it('should have a name', () => {
      expect(channel.name).toBe('test-channel')
    })

    it('should default to public type', () => {
      expect(channel.type).toBe('public')
    })

    it('should support private type', () => {
      const privateChannel = createChannel('private-channel', { type: 'private' })
      expect(privateChannel.type).toBe('private')
    })

    it('should support presence type', () => {
      const presenceChannel = createChannel('presence-channel', { type: 'presence' })
      expect(presenceChannel.type).toBe('presence')
    })
  })

  describe('publish', () => {
    it('should return a promise', async () => {
      const result = channel.publish('test', 'data')
      expect(result).toBeInstanceOf(Promise)
      await result
    })

    it('should resolve when no subscribers', async () => {
      await expect(channel.publish('test', 'data')).resolves.toBeUndefined()
    })
  })

  describe('subscribe', () => {
    it('should return a subscription with id', () => {
      const handler: Handler<string> = vi.fn()
      const subscription = channel.subscribe('test', handler)

      expect(subscription).toBeDefined()
      expect(subscription.id).toBeDefined()
      expect(typeof subscription.id).toBe('string')
    })

    it('should return unique subscription ids', () => {
      const handler: Handler<string> = vi.fn()
      const sub1 = channel.subscribe('test', handler)
      const sub2 = channel.subscribe('test', handler)

      expect(sub1.id).not.toBe(sub2.id)
    })

    it('should have unsubscribe method', () => {
      const handler: Handler<string> = vi.fn()
      const subscription = channel.subscribe('test', handler)

      expect(typeof subscription.unsubscribe).toBe('function')
    })

    it('should receive published data', async () => {
      const handler = vi.fn()
      channel.subscribe('greeting', handler)

      await channel.publish('greeting', 'Hello!')

      expect(handler).toHaveBeenCalledWith('Hello!', 'greeting')
    })

    it('should support multiple subscribers to same event', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      channel.subscribe('event', handler1)
      channel.subscribe('event', handler2)

      await channel.publish('event', 'data')

      expect(handler1).toHaveBeenCalledWith('data', 'event')
      expect(handler2).toHaveBeenCalledWith('data', 'event')
    })

    it('should only notify subscribers of matching event', async () => {
      const handlerA = vi.fn()
      const handlerB = vi.fn()

      channel.subscribe('event-a', handlerA)
      channel.subscribe('event-b', handlerB)

      await channel.publish('event-a', 'data-a')

      expect(handlerA).toHaveBeenCalledWith('data-a', 'event-a')
      expect(handlerB).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe', () => {
    it('should stop receiving events after unsubscribe via subscription.unsubscribe()', async () => {
      const handler = vi.fn()
      const subscription = channel.subscribe('event', handler)

      await channel.publish('event', 'first')
      expect(handler).toHaveBeenCalledTimes(1)

      subscription.unsubscribe()

      await channel.publish('event', 'second')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should stop receiving events after channel.unsubscribe(subscription)', async () => {
      const handler = vi.fn()
      const subscription = channel.subscribe('event', handler)

      await channel.publish('event', 'first')
      expect(handler).toHaveBeenCalledTimes(1)

      channel.unsubscribe(subscription)

      await channel.publish('event', 'second')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should not affect other subscribers when one unsubscribes', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      const sub1 = channel.subscribe('event', handler1)
      channel.subscribe('event', handler2)

      sub1.unsubscribe()

      await channel.publish('event', 'data')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledWith('data', 'event')
    })

    it('should be safe to unsubscribe multiple times', () => {
      const handler = vi.fn()
      const subscription = channel.subscribe('event', handler)

      subscription.unsubscribe()
      expect(() => subscription.unsubscribe()).not.toThrow()
    })

    it('should be safe to unsubscribe with invalid subscription', () => {
      const fakeSubscription: Subscription = {
        id: 'fake-id',
        unsubscribe: () => {}
      }
      expect(() => channel.unsubscribe(fakeSubscription)).not.toThrow()
    })
  })

  describe('typed data', () => {
    it('should preserve data types', async () => {
      interface Message {
        text: string
        count: number
      }

      const typedChannel = createChannel<Message>('typed')
      const handler = vi.fn()

      typedChannel.subscribe('msg', handler)
      await typedChannel.publish('msg', { text: 'hello', count: 42 })

      expect(handler).toHaveBeenCalledWith({ text: 'hello', count: 42 }, 'msg')
    })
  })
})

// =============================================================================
// TDD Cycle 2: Wildcard Subscriptions
// =============================================================================

describe('Channel - Wildcard Subscriptions', () => {
  let channel: Channel<string>

  beforeEach(() => {
    channel = createChannel<string>('wildcard-test')
  })

  describe('wildcard "*" pattern', () => {
    it('should receive all events with wildcard subscription', async () => {
      const wildcardHandler = vi.fn()
      channel.subscribe('*', wildcardHandler)

      await channel.publish('event-a', 'data-a')
      await channel.publish('event-b', 'data-b')
      await channel.publish('event-c', 'data-c')

      expect(wildcardHandler).toHaveBeenCalledTimes(3)
      expect(wildcardHandler).toHaveBeenCalledWith('data-a', 'event-a')
      expect(wildcardHandler).toHaveBeenCalledWith('data-b', 'event-b')
      expect(wildcardHandler).toHaveBeenCalledWith('data-c', 'event-c')
    })

    it('should receive event name as second argument', async () => {
      const wildcardHandler = vi.fn()
      channel.subscribe('*', wildcardHandler)

      await channel.publish('custom-event', 'payload')

      expect(wildcardHandler).toHaveBeenCalledWith('payload', 'custom-event')
    })

    it('should work alongside specific event subscriptions', async () => {
      const wildcardHandler = vi.fn()
      const specificHandler = vi.fn()

      channel.subscribe('*', wildcardHandler)
      channel.subscribe('specific', specificHandler)

      await channel.publish('specific', 'data')

      expect(wildcardHandler).toHaveBeenCalledWith('data', 'specific')
      expect(specificHandler).toHaveBeenCalledWith('data', 'specific')
    })

    it('should support multiple wildcard subscribers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      channel.subscribe('*', handler1)
      channel.subscribe('*', handler2)

      await channel.publish('event', 'data')

      expect(handler1).toHaveBeenCalledWith('data', 'event')
      expect(handler2).toHaveBeenCalledWith('data', 'event')
    })

    it('should unsubscribe wildcard handler correctly', async () => {
      const wildcardHandler = vi.fn()
      const subscription = channel.subscribe('*', wildcardHandler)

      await channel.publish('event-1', 'data-1')
      expect(wildcardHandler).toHaveBeenCalledTimes(1)

      subscription.unsubscribe()

      await channel.publish('event-2', 'data-2')
      expect(wildcardHandler).toHaveBeenCalledTimes(1)
    })

    it('should not affect specific subscriptions when wildcard unsubscribes', async () => {
      const wildcardHandler = vi.fn()
      const specificHandler = vi.fn()

      const wildcardSub = channel.subscribe('*', wildcardHandler)
      channel.subscribe('event', specificHandler)

      wildcardSub.unsubscribe()

      await channel.publish('event', 'data')

      expect(wildcardHandler).not.toHaveBeenCalled()
      expect(specificHandler).toHaveBeenCalledWith('data', 'event')
    })
  })
})

// =============================================================================
// TDD Cycle 3: Presence
// =============================================================================

describe('Channel - Presence', () => {
  describe('presence availability', () => {
    it('should not have presence on public channels', () => {
      const channel = createChannel('public-channel', { type: 'public' })
      expect(channel.presence).toBeUndefined()
    })

    it('should not have presence on private channels', () => {
      const channel = createChannel('private-channel', { type: 'private' })
      expect(channel.presence).toBeUndefined()
    })

    it('should have presence on presence channels', () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      expect(channel.presence).toBeDefined()
    })
  })

  describe('presence.members()', () => {
    it('should return empty iterable when no members', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const members: Member[] = []

      for await (const member of channel.presence!.members()) {
        members.push(member)
      }

      expect(members).toHaveLength(0)
    })

    it('should return all joined members', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })

      await channel.presence!.join({ id: 'user-1', info: { name: 'Alice' } })
      await channel.presence!.join({ id: 'user-2', info: { name: 'Bob' } })

      const members: Member[] = []
      for await (const member of channel.presence!.members()) {
        members.push(member)
      }

      expect(members).toHaveLength(2)
      expect(members.map(m => m.id)).toContain('user-1')
      expect(members.map(m => m.id)).toContain('user-2')
    })
  })

  describe('presence.join()', () => {
    it('should add member to presence set', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })

      await channel.presence!.join({ id: 'user-1' })

      const members: Member[] = []
      for await (const member of channel.presence!.members()) {
        members.push(member)
      }

      expect(members).toHaveLength(1)
      expect(members[0].id).toBe('user-1')
    })

    it('should include member info', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })

      await channel.presence!.join({ id: 'user-1', info: { name: 'Alice', role: 'admin' } })

      const members: Member[] = []
      for await (const member of channel.presence!.members()) {
        members.push(member)
      }

      expect(members[0].info).toEqual({ name: 'Alice', role: 'admin' })
    })

    it('should trigger onJoin handlers', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const joinHandler = vi.fn()

      channel.presence!.onJoin(joinHandler)
      await channel.presence!.join({ id: 'user-1', info: { name: 'Alice' } })

      expect(joinHandler).toHaveBeenCalledWith({ id: 'user-1', info: { name: 'Alice' } })
    })

    it('should support multiple onJoin handlers', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      channel.presence!.onJoin(handler1)
      channel.presence!.onJoin(handler2)
      await channel.presence!.join({ id: 'user-1' })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })

  describe('presence.leave()', () => {
    it('should remove member from presence set', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })

      await channel.presence!.join({ id: 'user-1' })
      await channel.presence!.leave()

      const members: Member[] = []
      for await (const member of channel.presence!.members()) {
        members.push(member)
      }

      expect(members).toHaveLength(0)
    })

    it('should trigger onLeave handlers', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const leaveHandler = vi.fn()

      channel.presence!.onLeave(leaveHandler)
      await channel.presence!.join({ id: 'user-1', info: { name: 'Alice' } })
      await channel.presence!.leave()

      expect(leaveHandler).toHaveBeenCalledWith({ id: 'user-1', info: { name: 'Alice' } })
    })

    it('should be safe to leave when not joined', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })

      await expect(channel.presence!.leave()).resolves.toBeUndefined()
    })

    it('should support multiple onLeave handlers', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      channel.presence!.onLeave(handler1)
      channel.presence!.onLeave(handler2)
      await channel.presence!.join({ id: 'user-1' })
      await channel.presence!.leave()

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })

  describe('presence subscription management', () => {
    it('should return subscription from onJoin', () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const subscription = channel.presence!.onJoin(vi.fn())

      expect(subscription.id).toBeDefined()
      expect(typeof subscription.unsubscribe).toBe('function')
    })

    it('should return subscription from onLeave', () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const subscription = channel.presence!.onLeave(vi.fn())

      expect(subscription.id).toBeDefined()
      expect(typeof subscription.unsubscribe).toBe('function')
    })

    it('should unsubscribe from onJoin correctly', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const handler = vi.fn()

      const subscription = channel.presence!.onJoin(handler)
      subscription.unsubscribe()

      await channel.presence!.join({ id: 'user-1' })

      expect(handler).not.toHaveBeenCalled()
    })

    it('should unsubscribe from onLeave correctly', async () => {
      const channel = createChannel('presence-channel', { type: 'presence' })
      const handler = vi.fn()

      const subscription = channel.presence!.onLeave(handler)
      await channel.presence!.join({ id: 'user-1' })

      subscription.unsubscribe()

      await channel.presence!.leave()

      expect(handler).not.toHaveBeenCalled()
    })
  })
})

// =============================================================================
// TDD Cycle 4: Backpressure
// =============================================================================

describe('Channel - Backpressure', () => {
  describe('buffer()', () => {
    it('should return this for chaining', () => {
      const channel = createChannel('test')
      const result = channel.buffer(10)
      expect(result).toBe(channel)
    })

    it('should buffer messages when no subscribers', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(10)

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const buffered = channel.getBufferedMessages()
      expect(buffered).toHaveLength(3)
      expect(buffered.map(m => m.data)).toEqual(['msg-1', 'msg-2', 'msg-3'])
    })

    it('should not buffer beyond capacity', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2)

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const buffered = channel.getBufferedMessages()
      expect(buffered).toHaveLength(2)
    })

    it('should not buffer when there are subscribers (messages delivered)', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(10)

      const handler = vi.fn()
      channel.subscribe('event', handler)

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      expect(handler).toHaveBeenCalledTimes(2)
      const buffered = channel.getBufferedMessages()
      expect(buffered).toHaveLength(0)
    })
  })

  describe('dropOldest()', () => {
    it('should return this for chaining', () => {
      const channel = createChannel('test')
      const result = channel.dropOldest()
      expect(result).toBe(channel)
    })

    it('should drop oldest messages when buffer full', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2).dropOldest()

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const buffered = channel.getBufferedMessages()
      expect(buffered).toHaveLength(2)
      expect(buffered.map(m => m.data)).toEqual(['msg-2', 'msg-3'])
    })

    it('should continue dropping oldest on subsequent overflows', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2).dropOldest()

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')
      await channel.publish('event', 'msg-4')
      await channel.publish('event', 'msg-5')

      const buffered = channel.getBufferedMessages()
      expect(buffered.map(m => m.data)).toEqual(['msg-4', 'msg-5'])
    })
  })

  describe('dropNewest()', () => {
    it('should return this for chaining', () => {
      const channel = createChannel('test')
      const result = channel.dropNewest()
      expect(result).toBe(channel)
    })

    it('should drop newest messages when buffer full', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2).dropNewest()

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const buffered = channel.getBufferedMessages()
      expect(buffered).toHaveLength(2)
      expect(buffered.map(m => m.data)).toEqual(['msg-1', 'msg-2'])
    })

    it('should continue dropping newest on subsequent overflows', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2).dropNewest()

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')
      await channel.publish('event', 'msg-4')
      await channel.publish('event', 'msg-5')

      const buffered = channel.getBufferedMessages()
      expect(buffered.map(m => m.data)).toEqual(['msg-1', 'msg-2'])
    })
  })

  describe('method chaining', () => {
    it('should support chained configuration', () => {
      const channel = createChannel('test')
      const result = channel.buffer(100).dropOldest()

      expect(result).toBe(channel)
    })

    it('should allow switching drop strategies', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(2).dropOldest()

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      // Switch to dropNewest
      channel.dropNewest()

      await channel.publish('event', 'msg-4')
      await channel.publish('event', 'msg-5')

      // Buffer should still have msg-2, msg-3 from before (oldest dropped)
      // After switching to dropNewest, msg-4 and msg-5 should be dropped
      const buffered = channel.getBufferedMessages()
      expect(buffered.map(m => m.data)).toEqual(['msg-2', 'msg-3'])
    })
  })

  describe('buffer stores event metadata', () => {
    it('should store event name with buffered message', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(10)

      await channel.publish('event-a', 'data-a')
      await channel.publish('event-b', 'data-b')

      const buffered = channel.getBufferedMessages()
      expect(buffered[0].event).toBe('event-a')
      expect(buffered[1].event).toBe('event-b')
    })

    it('should store timestamp with buffered message', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(10)

      const before = Date.now()
      await channel.publish('event', 'data')
      const after = Date.now()

      const buffered = channel.getBufferedMessages()
      expect(buffered[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(buffered[0].timestamp).toBeLessThanOrEqual(after)
    })

    it('should generate unique IDs for buffered messages', async () => {
      const channel = createChannel<string>('test')
      channel.buffer(10)

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      const buffered = channel.getBufferedMessages()
      expect(buffered[0].id).toBeDefined()
      expect(buffered[1].id).toBeDefined()
      expect(buffered[0].id).not.toBe(buffered[1].id)
    })
  })
})

// =============================================================================
// TDD Cycle 5: Persistence
// =============================================================================

describe('Channel - Persistence', () => {
  describe('persistent()', () => {
    it('should return this for chaining', () => {
      const channel = createChannel('test')
      const result = channel.persistent({})
      expect(result).toBe(channel)
    })

    it('should store published messages', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(2)
      expect(persisted.map(m => m.data)).toEqual(['msg-1', 'msg-2'])
    })

    it('should store event metadata', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      const before = Date.now()
      await channel.publish('my-event', 'data')
      const after = Date.now()

      const persisted = channel.getPersistedMessages()
      expect(persisted[0].event).toBe('my-event')
      expect(persisted[0].id).toBeDefined()
      expect(persisted[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(persisted[0].timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('maxMessages', () => {
    it('should limit stored messages', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({ maxMessages: 2 })

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(2)
      expect(persisted.map(m => m.data)).toEqual(['msg-2', 'msg-3'])
    })

    it('should drop oldest when limit exceeded', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({ maxMessages: 3 })

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')
      await channel.publish('event', 'msg-4')
      await channel.publish('event', 'msg-5')

      const persisted = channel.getPersistedMessages()
      expect(persisted.map(m => m.data)).toEqual(['msg-3', 'msg-4', 'msg-5'])
    })
  })

  describe('maxAge', () => {
    it('should expire old messages', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({ maxAge: 100 }) // 100ms

      await channel.publish('event', 'msg-1')

      // Wait for message to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      await channel.publish('event', 'msg-2')

      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(1)
      expect(persisted[0].data).toBe('msg-2')
    })

    it('should keep messages within maxAge', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({ maxAge: 1000 }) // 1 second

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(2)
    })
  })

  describe('replayTo()', () => {
    it('should replay all persisted messages', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event-a', 'msg-1')
      await channel.publish('event-b', 'msg-2')
      await channel.publish('event-a', 'msg-3')

      const replayed: Array<{ data: string; event: string }> = []
      channel.replayTo((data, event) => {
        replayed.push({ data, event: event! })
      })

      expect(replayed).toHaveLength(3)
      expect(replayed).toEqual([
        { data: 'msg-1', event: 'event-a' },
        { data: 'msg-2', event: 'event-b' },
        { data: 'msg-3', event: 'event-a' },
      ])
    })

    it('should filter by event name', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event-a', 'msg-1')
      await channel.publish('event-b', 'msg-2')
      await channel.publish('event-a', 'msg-3')

      const replayed: string[] = []
      channel.replayTo((data) => {
        replayed.push(data)
      }, { event: 'event-a' })

      expect(replayed).toEqual(['msg-1', 'msg-3'])
    })

    it('should filter by timestamp (since)', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event', 'msg-1')

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))
      const middleTime = Date.now()
      await new Promise(resolve => setTimeout(resolve, 10))

      await channel.publish('event', 'msg-2')
      await channel.publish('event', 'msg-3')

      const replayed: string[] = []
      channel.replayTo((data) => {
        replayed.push(data)
      }, { since: middleTime })

      expect(replayed).toEqual(['msg-2', 'msg-3'])
    })

    it('should support combined filters', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event-a', 'msg-1')
      await channel.publish('event-b', 'msg-2')

      // Wait to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10))
      const middleTime = Date.now()
      await new Promise(resolve => setTimeout(resolve, 10))

      await channel.publish('event-a', 'msg-3')
      await channel.publish('event-b', 'msg-4')
      await channel.publish('event-a', 'msg-5')

      const replayed: string[] = []
      channel.replayTo((data) => {
        replayed.push(data)
      }, { event: 'event-a', since: middleTime })

      expect(replayed).toEqual(['msg-3', 'msg-5'])
    })
  })

  describe('persistence and delivery', () => {
    it('should persist AND deliver to subscribers', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      const handler = vi.fn()
      channel.subscribe('event', handler)

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      // Messages should be delivered
      expect(handler).toHaveBeenCalledTimes(2)

      // And also persisted
      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(2)
    })

    it('should persist even when no subscribers', async () => {
      const channel = createChannel<string>('test')
      channel.persistent({})

      await channel.publish('event', 'msg-1')
      await channel.publish('event', 'msg-2')

      const persisted = channel.getPersistedMessages()
      expect(persisted).toHaveLength(2)
    })
  })

  describe('method chaining with persistence', () => {
    it('should support buffer + persistent', () => {
      const channel = createChannel('test')
      const result = channel.buffer(100).persistent({ maxMessages: 1000 })

      expect(result).toBe(channel)
    })

    it('should support persistent + dropOldest', () => {
      const channel = createChannel('test')
      const result = channel.persistent({}).buffer(10).dropOldest()

      expect(result).toBe(channel)
    })
  })
})

// =============================================================================
// TDD Cycle 6: Factory Function with API Compatibility
// =============================================================================

describe('Channel - Factory and API Compatibility', () => {
  describe('createChannel factory', () => {
    it('should create channel with default options', () => {
      const channel = createChannel('test')
      expect(channel.name).toBe('test')
      expect(channel.type).toBe('public')
    })

    it('should accept type option', () => {
      const channel = createChannel('test', { type: 'private' })
      expect(channel.type).toBe('private')
    })

    it('should accept style option', () => {
      const channel = createChannel('test', { style: 'pusher' })
      expect(channel.name).toBe('test')
    })

    it('should accept both type and style options', () => {
      const channel = createChannel('test', { type: 'presence', style: 'ably' })
      expect(channel.type).toBe('presence')
      expect(channel.presence).toBeDefined()
    })
  })

  describe('Node.js EventEmitter style (default)', () => {
    it('should work with standard subscribe/publish pattern', async () => {
      const channel = createChannel<string>('node-style')
      const handler = vi.fn()

      channel.subscribe('event', handler)
      await channel.publish('event', 'data')

      expect(handler).toHaveBeenCalledWith('data', 'event')
    })
  })

  describe('Pusher style', () => {
    it('should support pusher style channel creation', async () => {
      const channel = createChannel<string>('pusher-channel', { style: 'pusher' })
      const handler = vi.fn()

      // Pusher uses bind/unbind but our unified API uses subscribe/unsubscribe
      // The factory just tracks the style for potential adapter use
      channel.subscribe('event', handler)
      await channel.publish('event', 'data')

      expect(handler).toHaveBeenCalledWith('data', 'event')
    })
  })

  describe('Socket.IO style', () => {
    it('should support socketio style channel creation', async () => {
      const channel = createChannel<string>('socket-channel', { style: 'socketio' })
      const handler = vi.fn()

      channel.subscribe('event', handler)
      await channel.publish('event', 'data')

      expect(handler).toHaveBeenCalledWith('data', 'event')
    })
  })

  describe('Ably style', () => {
    it('should support ably style channel creation', async () => {
      const channel = createChannel<string>('ably-channel', { style: 'ably' })
      const handler = vi.fn()

      channel.subscribe('event', handler)
      await channel.publish('event', 'data')

      expect(handler).toHaveBeenCalledWith('data', 'event')
    })
  })

  describe('integration with all features', () => {
    it('should support all features regardless of style', async () => {
      const channel = createChannel<string>('full-featured', {
        type: 'presence',
        style: 'pusher'
      })

      // Configure backpressure
      channel.buffer(100).dropOldest()

      // Configure persistence
      channel.persistent({ maxMessages: 50, maxAge: 60000 })

      // Test pub/sub
      const handler = vi.fn()
      channel.subscribe('event', handler)
      await channel.publish('event', 'message')
      expect(handler).toHaveBeenCalledWith('message', 'event')

      // Test wildcard
      const wildcardHandler = vi.fn()
      channel.subscribe('*', wildcardHandler)
      await channel.publish('any-event', 'broadcast')
      expect(wildcardHandler).toHaveBeenCalledWith('broadcast', 'any-event')

      // Test presence
      expect(channel.presence).toBeDefined()
      await channel.presence!.join({ id: 'user-1' })

      const members: Member[] = []
      for await (const member of channel.presence!.members()) {
        members.push(member)
      }
      expect(members).toHaveLength(1)
    })
  })
})
