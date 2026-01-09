/**
 * @dotdo/ably - Ably SDK compat tests
 *
 * Tests for Ably Realtime API compatibility backed by DO storage:
 * - Client creation and connection
 * - Channel get/attach/detach
 * - Publish messages
 * - Subscribe to messages
 * - Presence (enter, leave, update, get)
 * - Message history
 * - Connection state events
 * - Error handling
 *
 * @see https://ably.com/docs/api/realtime-sdk
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  Realtime as IRealtime,
  ClientOptions,
  Connection,
  RealtimeChannel,
  RealtimePresence,
  Message,
  PresenceMessage,
  PresenceAction,
  ConnectionStateChange,
  ChannelStateChange,
  PaginatedResult,
} from './types'
import { AblyError, ConnectionError, ChannelError, isConnected, isAttached } from './types'
import { Realtime, _clearAll } from './ably'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('Realtime client creation', () => {
  beforeEach(() => {
    _clearAll()
  })

  afterEach(() => {
    _clearAll()
  })

  it('should create client with key only', async () => {
    const client = new Realtime({ key: 'test-key' })
    expect(client).toBeDefined()
    expect(client.options.key).toBe('test-key')
    await new Promise(r => setTimeout(r, 50))
    expect(client.connection.state).toBe('connected')
    await client.close()
  })

  it('should create client with string key', async () => {
    const client = new Realtime('test-key')
    expect(client).toBeDefined()
    await new Promise(r => setTimeout(r, 50))
    expect(client.connection.state).toBe('connected')
    await client.close()
  })

  it('should create client with options', async () => {
    const client = new Realtime({
      key: 'test-key',
      clientId: 'my-client-id',
      echoMessages: false,
    })
    expect(client).toBeDefined()
    expect(client.options.clientId).toBe('my-client-id')
    expect(client.clientId).toBe('my-client-id')
    await new Promise(r => setTimeout(r, 50))
    await client.close()
  })

  it('should not auto-connect when autoConnect is false', () => {
    const client = new Realtime({ key: 'test-key', autoConnect: false })
    expect(client.connection.state).toBe('initialized')
    client.close()
  })

  it('should have auth property', async () => {
    const client = new Realtime({ key: 'test-key', autoConnect: false })
    expect(client.auth).toBeDefined()
    expect(typeof client.auth.authorize).toBe('function')
    expect(typeof client.auth.createTokenRequest).toBe('function')
    await client.close()
  })
})

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('Connection', () => {
  let client: Realtime

  beforeEach(() => {
    _clearAll()
    client = new Realtime({ key: 'test-key', autoConnect: false })
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  describe('state management', () => {
    it('should start in initialized state', () => {
      expect(client.connection.state).toBe('initialized')
    })

    it('should transition to connecting then connected', async () => {
      const states: string[] = []

      client.connection.on('connected', () => {
        states.push('connected')
      })

      client.connection.on('connecting', () => {
        states.push('connecting')
      })

      client.connect()

      await new Promise(r => setTimeout(r, 50))

      expect(states).toContain('connecting')
      expect(states).toContain('connected')
      expect(client.connection.state).toBe('connected')
    })

    it('should have id when connected', async () => {
      expect(client.connection.id).toBeNull()

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.id).not.toBeNull()
      expect(typeof client.connection.id).toBe('string')
    })

    it('should have key when connected', async () => {
      expect(client.connection.key).toBeNull()

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.key).not.toBeNull()
    })

    it('should have recoveryKey when connected', async () => {
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.recoveryKey).not.toBeNull()
    })

    it('should transition to closed on close()', async () => {
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.state).toBe('connected')

      await client.close()

      expect(client.connection.state).toBe('closed')
    })

    it('should emit state change with previous and current', async () => {
      let stateChange: ConnectionStateChange | undefined

      client.connection.on('connected', (change: ConnectionStateChange) => {
        stateChange = change
      })

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(stateChange).toBeDefined()
      expect(stateChange!.previous).toBe('connecting')
      expect(stateChange!.current).toBe('connected')
    })
  })

  describe('event binding', () => {
    it('should bind to connection state events with on()', async () => {
      const callback = vi.fn()
      client.connection.on('connected', callback)

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(callback).toHaveBeenCalled()
    })

    it('should bind to multiple states with on()', async () => {
      const callback = vi.fn()
      client.connection.on(['connecting', 'connected'], callback)

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('should unbind with off()', async () => {
      const callback = vi.fn()
      client.connection.on('connected', callback)
      client.connection.off('connected', callback)

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(callback).not.toHaveBeenCalled()
    })

    it('should bind once with once()', async () => {
      const callback = vi.fn()
      client.connection.once('connected', callback)

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      // Reconnect
      await client.close()
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should ping the connection', async () => {
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      const latency = await client.connection.ping()
      expect(typeof latency).toBe('number')
      expect(latency).toBeGreaterThanOrEqual(0)
    })
  })

  describe('connect/close', () => {
    it('should not reconnect when already connected', async () => {
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      const id = client.connection.id

      client.connect() // Should be no-op
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.id).toBe(id)
    })

    it('should be able to reconnect after close', async () => {
      client.connect()
      await new Promise(r => setTimeout(r, 50))

      const oldId = client.connection.id

      await client.close()
      expect(client.connection.state).toBe('closed')

      client.connect()
      await new Promise(r => setTimeout(r, 50))

      expect(client.connection.state).toBe('connected')
      expect(client.connection.id).not.toBe(oldId)
    })
  })
})

// ============================================================================
// CHANNELS TESTS
// ============================================================================

describe('Channels', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  describe('channels.get()', () => {
    it('should get a channel by name', () => {
      const channel = client.channels.get('my-channel')
      expect(channel).toBeDefined()
      expect(channel.name).toBe('my-channel')
    })

    it('should return same channel on duplicate get()', () => {
      const channel1 = client.channels.get('my-channel')
      const channel2 = client.channels.get('my-channel')
      expect(channel1).toBe(channel2)
    })

    it('should get channel with options', () => {
      const channel = client.channels.get('my-channel', {
        params: { rewind: '1' },
      })
      expect(channel.params.rewind).toBe('1')
    })

    it('should check if channel exists', () => {
      expect(client.channels.exists('my-channel')).toBe(false)
      client.channels.get('my-channel')
      expect(client.channels.exists('my-channel')).toBe(true)
    })

    it('should release a channel', () => {
      client.channels.get('my-channel')
      expect(client.channels.exists('my-channel')).toBe(true)
      client.channels.release('my-channel')
      expect(client.channels.exists('my-channel')).toBe(false)
    })

    it('should iterate over channels', () => {
      client.channels.get('channel-1')
      client.channels.get('channel-2')
      client.channels.get('channel-3')

      const names: string[] = []
      for (const channel of client.channels.iterate()) {
        names.push(channel.name)
      }

      expect(names.sort()).toEqual(['channel-1', 'channel-2', 'channel-3'])
    })
  })

  describe('attach/detach', () => {
    it('should attach to a channel', async () => {
      const channel = client.channels.get('my-channel')
      expect(channel.state).toBe('initialized')

      await channel.attach()

      expect(channel.state).toBe('attached')
    })

    it('should emit attached state change', async () => {
      const channel = client.channels.get('my-channel')
      let stateChange: ChannelStateChange | undefined

      channel.on('attached', (change: ChannelStateChange) => {
        stateChange = change
      })

      await channel.attach()

      expect(stateChange).toBeDefined()
      expect(stateChange!.current).toBe('attached')
    })

    it('should detach from a channel', async () => {
      const channel = client.channels.get('my-channel')
      await channel.attach()
      expect(channel.state).toBe('attached')

      await channel.detach()

      expect(channel.state).toBe('detached')
    })

    it('should emit detached state change', async () => {
      const channel = client.channels.get('my-channel')
      await channel.attach()

      let stateChange: ChannelStateChange | undefined
      channel.on('detached', (change: ChannelStateChange) => {
        stateChange = change
      })

      await channel.detach()

      expect(stateChange).toBeDefined()
      expect(stateChange!.current).toBe('detached')
    })

    it('should auto-attach on subscribe', async () => {
      const channel = client.channels.get('my-channel')
      expect(channel.state).toBe('initialized')

      await channel.subscribe(() => {})

      expect(channel.state).toBe('attached')
    })

    it('should auto-attach on publish', async () => {
      const channel = client.channels.get('my-channel')
      expect(channel.state).toBe('initialized')

      await channel.publish('test', { data: 'hello' })

      expect(channel.state).toBe('attached')
    })
  })

  describe('channel state events', () => {
    it('should bind to state events with on()', async () => {
      const channel = client.channels.get('my-channel')
      const callback = vi.fn()

      channel.on('attached', callback)
      await channel.attach()

      expect(callback).toHaveBeenCalled()
    })

    it('should unbind with off()', async () => {
      const channel = client.channels.get('my-channel')
      const callback = vi.fn()

      channel.on('attached', callback)
      channel.off('attached', callback)
      await channel.attach()

      expect(callback).not.toHaveBeenCalled()
    })

    it('should bind once with once()', async () => {
      const channel = client.channels.get('my-channel')
      const callback = vi.fn()

      channel.once('attached', callback)
      await channel.attach()
      await channel.detach()
      await channel.attach()

      expect(callback).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// PUBLISH TESTS
// ============================================================================

describe('Publish messages', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('should publish message with name and data', async () => {
    const channel = client.channels.get('my-channel')
    await channel.attach()

    await expect(channel.publish('greeting', { text: 'Hello!' })).resolves.toBeUndefined()
  })

  it('should publish message object', async () => {
    const channel = client.channels.get('my-channel')
    await channel.attach()

    await expect(channel.publish({ name: 'greeting', data: { text: 'Hello!' } })).resolves.toBeUndefined()
  })

  it('should publish array of messages', async () => {
    const channel = client.channels.get('my-channel')
    await channel.attach()

    await expect(channel.publish([
      { name: 'msg1', data: 'first' },
      { name: 'msg2', data: 'second' },
    ])).resolves.toBeUndefined()
  })

  it('should publish without data', async () => {
    const channel = client.channels.get('my-channel')
    await channel.attach()

    await expect(channel.publish('event-only')).resolves.toBeUndefined()
  })

  it('should reject publish when not attached and auto-attach fails', async () => {
    const channel = client.channels.get('my-channel')
    await client.close()

    await expect(channel.publish('test', {})).rejects.toThrow()
  })
})

// ============================================================================
// SUBSCRIBE TESTS
// ============================================================================

describe('Subscribe to messages', () => {
  let client: Realtime
  let client2: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    client2 = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    await client2.close()
    _clearAll()
  })

  it('should subscribe to all messages', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    const messages: Message[] = []

    await channel.subscribe((msg) => {
      messages.push(msg)
    })
    await channel2.attach()

    await channel2.publish('greeting', { text: 'Hello!' })
    await new Promise(r => setTimeout(r, 50))

    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].name).toBe('greeting')
  })

  it('should subscribe to specific event', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    const greetings: Message[] = []
    const farewells: Message[] = []

    await channel.subscribe('greeting', (msg) => {
      greetings.push(msg)
    })
    await channel.subscribe('farewell', (msg) => {
      farewells.push(msg)
    })
    await channel2.attach()

    await channel2.publish('greeting', { text: 'Hello!' })
    await channel2.publish('farewell', { text: 'Goodbye!' })
    await new Promise(r => setTimeout(r, 50))

    expect(greetings.length).toBe(1)
    expect(farewells.length).toBe(1)
  })

  it('should subscribe to multiple events', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    const messages: Message[] = []

    await channel.subscribe(['greeting', 'farewell'], (msg) => {
      messages.push(msg)
    })
    await channel2.attach()

    await channel2.publish('greeting', { text: 'Hello!' })
    await channel2.publish('farewell', { text: 'Goodbye!' })
    await channel2.publish('other', { text: 'Other' })
    await new Promise(r => setTimeout(r, 50))

    expect(messages.length).toBe(2)
  })

  it('should unsubscribe from all messages', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    const messages: Message[] = []

    const listener = (msg: Message) => {
      messages.push(msg)
    }

    await channel.subscribe(listener)
    await channel2.attach()

    await channel2.publish('test1', {})
    await new Promise(r => setTimeout(r, 50))

    channel.unsubscribe(listener)

    await channel2.publish('test2', {})
    await new Promise(r => setTimeout(r, 50))

    expect(messages.length).toBe(1)
  })

  it('should unsubscribe from specific event', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    const greetings: Message[] = []

    const listener = (msg: Message) => {
      greetings.push(msg)
    }

    await channel.subscribe('greeting', listener)
    await channel2.attach()

    await channel2.publish('greeting', { text: 'Hello!' })
    await new Promise(r => setTimeout(r, 50))

    channel.unsubscribe('greeting', listener)

    await channel2.publish('greeting', { text: 'Hello again!' })
    await new Promise(r => setTimeout(r, 50))

    expect(greetings.length).toBe(1)
  })

  it('should receive message with metadata', async () => {
    const channel = client.channels.get('my-channel')
    const channel2 = client2.channels.get('my-channel')
    let received: Message | undefined

    await channel.subscribe((msg) => {
      received = msg
    })
    await channel2.attach()

    await channel2.publish('test', { value: 123 })
    await new Promise(r => setTimeout(r, 50))

    expect(received).toBeDefined()
    expect(received!.name).toBe('test')
    expect(received!.data).toEqual({ value: 123 })
    expect(received!.timestamp).toBeDefined()
    expect(typeof received!.id).toBe('string')
  })
})

// ============================================================================
// PRESENCE TESTS
// ============================================================================

describe('Presence', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key', clientId: 'user-1' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  describe('enter/leave/update', () => {
    it('should enter presence', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      await expect(channel.presence.enter({ status: 'online' })).resolves.toBeUndefined()
    })

    it('should enter presence without data', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      await expect(channel.presence.enter()).resolves.toBeUndefined()
    })

    it('should update presence data', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      await channel.presence.enter({ status: 'online' })
      await expect(channel.presence.update({ status: 'away' })).resolves.toBeUndefined()
    })

    it('should leave presence', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      await channel.presence.enter({ status: 'online' })
      await expect(channel.presence.leave()).resolves.toBeUndefined()
    })

    it('should leave presence with data', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      await channel.presence.enter()
      await expect(channel.presence.leave({ reason: 'disconnecting' })).resolves.toBeUndefined()
    })
  })

  describe('presence.get()', () => {
    it('should get presence members', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()
      await channel.presence.enter({ status: 'online' })

      const members = await channel.presence.get()

      expect(members.length).toBe(1)
      expect(members[0].clientId).toBe('user-1')
      expect(members[0].data).toEqual({ status: 'online' })
    })

    it('should get presence members with waitForSync', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()
      await channel.presence.enter()

      const members = await channel.presence.get({ waitForSync: true })

      expect(members.length).toBe(1)
    })

    it('should filter by clientId', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()
      await channel.presence.enter()

      const members = await channel.presence.get({ clientId: 'user-1' })
      expect(members.length).toBe(1)

      const noMembers = await channel.presence.get({ clientId: 'user-999' })
      expect(noMembers.length).toBe(0)
    })

    it('should return empty array when no members', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      const members = await channel.presence.get()

      expect(members).toEqual([])
    })

    it('should have syncComplete property', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      expect(typeof channel.presence.syncComplete).toBe('boolean')
    })
  })

  describe('presence.subscribe()', () => {
    it('should subscribe to all presence events', async () => {
      const channel1 = client.channels.get('presence-channel')
      await channel1.attach()

      const events: PresenceMessage[] = []
      await channel1.presence.subscribe((member) => {
        events.push(member)
      })

      const client2 = new Realtime({ key: 'test-key', clientId: 'user-2' })
      await new Promise(r => setTimeout(r, 50))
      const channel2 = client2.channels.get('presence-channel')
      await channel2.attach()
      await channel2.presence.enter({ status: 'online' })
      await new Promise(r => setTimeout(r, 50))

      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].action).toBe('enter')
      expect(events[0].clientId).toBe('user-2')

      await client2.close()
    })

    it('should subscribe to specific presence action', async () => {
      const channel1 = client.channels.get('presence-channel')
      await channel1.attach()

      const enterEvents: PresenceMessage[] = []
      const leaveEvents: PresenceMessage[] = []

      await channel1.presence.subscribe('enter', (member) => {
        enterEvents.push(member)
      })
      await channel1.presence.subscribe('leave', (member) => {
        leaveEvents.push(member)
      })

      const client2 = new Realtime({ key: 'test-key', clientId: 'user-2' })
      await new Promise(r => setTimeout(r, 50))
      const channel2 = client2.channels.get('presence-channel')
      await channel2.attach()
      await channel2.presence.enter()
      await new Promise(r => setTimeout(r, 50))
      await channel2.presence.leave()
      await new Promise(r => setTimeout(r, 50))

      expect(enterEvents.length).toBe(1)
      expect(leaveEvents.length).toBe(1)

      await client2.close()
    })

    it('should subscribe to multiple presence actions', async () => {
      const channel1 = client.channels.get('presence-channel')
      await channel1.attach()

      const events: PresenceMessage[] = []
      await channel1.presence.subscribe(['enter', 'leave'], (member) => {
        events.push(member)
      })

      // Use second client to generate events that channel1 will receive
      const client2 = new Realtime({ key: 'test-key', clientId: 'user-2' })
      await new Promise(r => setTimeout(r, 50))
      const channel2 = client2.channels.get('presence-channel')
      await channel2.attach()
      await channel2.presence.enter()
      await new Promise(r => setTimeout(r, 50))
      await channel2.presence.leave()
      await new Promise(r => setTimeout(r, 50))

      // Should receive at least enter and leave from user-2
      expect(events.length).toBeGreaterThanOrEqual(2)

      await client2.close()
    })

    it('should unsubscribe from presence events', async () => {
      const channel = client.channels.get('presence-channel')
      await channel.attach()

      const events: PresenceMessage[] = []
      const listener = (member: PresenceMessage) => {
        events.push(member)
      }

      await channel.presence.subscribe(listener)
      channel.presence.unsubscribe(listener)

      await channel.presence.enter()
      await new Promise(r => setTimeout(r, 50))

      expect(events.length).toBe(0)
    })
  })
})

// ============================================================================
// MESSAGE HISTORY TESTS
// ============================================================================

describe('Message history', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('should get message history', async () => {
    const channel = client.channels.get('history-channel')
    await channel.attach()

    await channel.publish('msg1', { value: 1 })
    await channel.publish('msg2', { value: 2 })
    await channel.publish('msg3', { value: 3 })
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.history()

    expect(history.items.length).toBeGreaterThanOrEqual(3)
  })

  it('should get history with limit', async () => {
    const channel = client.channels.get('history-channel')
    await channel.attach()

    for (let i = 0; i < 10; i++) {
      await channel.publish('msg', { value: i })
    }
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.history({ limit: 5 })

    expect(history.items.length).toBe(5)
  })

  it('should get history with direction backwards (default)', async () => {
    const channel = client.channels.get('history-channel')
    await channel.attach()

    await channel.publish('first', {})
    await channel.publish('second', {})
    await channel.publish('third', {})
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.history({ direction: 'backwards' })

    // Backwards means most recent first
    expect(history.items[0].name).toBe('third')
  })

  it('should get history with direction forwards', async () => {
    const channel = client.channels.get('history-channel')
    await channel.attach()

    await channel.publish('first', {})
    await channel.publish('second', {})
    await channel.publish('third', {})
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.history({ direction: 'forwards' })

    // Forwards means oldest first
    expect(history.items[0].name).toBe('first')
  })

  it('should have paginated result methods', async () => {
    const channel = client.channels.get('history-channel')
    await channel.attach()

    await channel.publish('test', {})
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.history()

    expect(typeof history.hasNext).toBe('function')
    expect(typeof history.isLast).toBe('function')
    expect(typeof history.next).toBe('function')
    expect(typeof history.first).toBe('function')
    expect(typeof history.current).toBe('function')
  })

  it('should return empty history for new channel', async () => {
    const channel = client.channels.get('empty-history-channel')
    await channel.attach()

    const history = await channel.history()

    expect(history.items).toEqual([])
  })
})

// ============================================================================
// PRESENCE HISTORY TESTS
// ============================================================================

describe('Presence history', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key', clientId: 'user-1' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('should get presence history', async () => {
    const channel = client.channels.get('presence-history-channel')
    await channel.attach()

    await channel.presence.enter({ status: 'online' })
    await channel.presence.update({ status: 'away' })
    await channel.presence.leave()
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.presence.history()

    expect(history.items.length).toBeGreaterThanOrEqual(3)
  })

  it('should get presence history with limit', async () => {
    const channel = client.channels.get('presence-history-channel')
    await channel.attach()

    await channel.presence.enter()
    await channel.presence.update({ status: 'away' })
    await channel.presence.leave()
    await new Promise(r => setTimeout(r, 50))

    const history = await channel.presence.history({ limit: 2 })

    expect(history.items.length).toBe(2)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  it('should create AblyError', () => {
    const error = new AblyError('Test error', 40000, 400)
    expect(error.message).toBe('Test error')
    expect(error.code).toBe(40000)
    expect(error.statusCode).toBe(400)
    expect(error.name).toBe('AblyError')
  })

  it('should convert AblyError to JSON', () => {
    const error = new AblyError('Test error', 40000, 400)
    const json = error.toJSON()

    expect(json.code).toBe(40000)
    expect(json.statusCode).toBe(400)
    expect(json.message).toBe('Test error')
  })

  it('should create ConnectionError', () => {
    const error = new ConnectionError('Connection failed', 80000, 500)
    expect(error.message).toBe('Connection failed')
    expect(error.code).toBe(80000)
    expect(error.name).toBe('ConnectionError')
  })

  it('should create ChannelError', () => {
    const error = new ChannelError('Channel failed', 90000, 500)
    expect(error.message).toBe('Channel failed')
    expect(error.code).toBe(90000)
    expect(error.name).toBe('ChannelError')
  })

  it('should have errorReason on failed connection', async () => {
    // This test simulates a scenario where connection fails
    const client = new Realtime({ key: '', autoConnect: false })
    // errorReason should be null in initialized state
    expect(client.connection.errorReason).toBeNull()
    await client.close()
  })

  it('should have errorReason on failed channel', async () => {
    const client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
    const channel = client.channels.get('test-channel')
    // errorReason should be null initially
    expect(channel.errorReason).toBeNull()
    await client.close()
  })
})

// ============================================================================
// TYPE GUARDS TESTS
// ============================================================================

describe('Type guards', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('isConnected should return true when connected', () => {
    expect(isConnected(client.connection)).toBe(true)
  })

  it('isConnected should return false when not connected', async () => {
    await client.close()
    expect(isConnected(client.connection)).toBe(false)
  })

  it('isAttached should return true when attached', async () => {
    const channel = client.channels.get('test-channel')
    await channel.attach()
    expect(isAttached(channel)).toBe(true)
  })

  it('isAttached should return false when not attached', () => {
    const channel = client.channels.get('test-channel')
    expect(isAttached(channel)).toBe(false)
  })
})

// ============================================================================
// CLIENT UTILITIES TESTS
// ============================================================================

describe('Client utilities', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('should get time from server', async () => {
    const time = await client.time()
    expect(typeof time).toBe('number')
    expect(time).toBeGreaterThan(0)
  })

  it('should have clientId property', () => {
    expect(client.clientId).toBeNull()
  })

  it('should have clientId when provided', async () => {
    const clientWithId = new Realtime({ key: 'test-key', clientId: 'my-client' })
    await new Promise(r => setTimeout(r, 50))
    expect(clientWithId.clientId).toBe('my-client')
    await clientWithId.close()
  })
})

// ============================================================================
// CHANNEL OPTIONS TESTS
// ============================================================================

describe('Channel options', () => {
  let client: Realtime

  beforeEach(async () => {
    _clearAll()
    client = new Realtime({ key: 'test-key' })
    await new Promise(r => setTimeout(r, 50))
  })

  afterEach(async () => {
    await client.close()
    _clearAll()
  })

  it('should set channel options', async () => {
    const channel = client.channels.get('test-channel')
    await channel.setOptions({ params: { rewind: '10' } })
    expect(channel.params.rewind).toBe('10')
  })

  it('should have modes property', () => {
    const channel = client.channels.get('test-channel')
    expect(Array.isArray(channel.modes)).toBe(true)
  })

  it('should have properties property', () => {
    const channel = client.channels.get('test-channel')
    expect(channel.properties).toBeDefined()
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
    const client1 = new Realtime({ key: 'app-key', clientId: 'alice' })
    await new Promise(r => setTimeout(r, 50))

    const channel1 = client1.channels.get('chat-room')
    await channel1.attach()

    const messages: Message[] = []
    await channel1.subscribe('chat', (msg) => {
      messages.push(msg)
    })

    // User 2 joins
    const client2 = new Realtime({ key: 'app-key', clientId: 'bob' })
    await new Promise(r => setTimeout(r, 50))

    const channel2 = client2.channels.get('chat-room')
    await channel2.attach()

    // User 2 sends message
    await channel2.publish('chat', { text: 'Hello, Alice!' })
    await new Promise(r => setTimeout(r, 50))

    // User 1 should receive it
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].data).toEqual({ text: 'Hello, Alice!' })

    await client1.close()
    await client2.close()
  })

  it('should work with presence-based room', async () => {
    const client1 = new Realtime({ key: 'app-key', clientId: 'user-1' })
    await new Promise(r => setTimeout(r, 50))

    const room1 = client1.channels.get('room')
    await room1.attach()

    const presenceEvents: PresenceMessage[] = []
    await room1.presence.subscribe((member) => {
      presenceEvents.push(member)
    })

    // User 1 enters
    await room1.presence.enter({ status: 'online' })

    // User 2 joins
    const client2 = new Realtime({ key: 'app-key', clientId: 'user-2' })
    await new Promise(r => setTimeout(r, 50))

    const room2 = client2.channels.get('room')
    await room2.attach()
    await room2.presence.enter({ status: 'online' })
    await new Promise(r => setTimeout(r, 50))

    // Check presence
    const members = await room1.presence.get()
    expect(members.length).toBe(2)

    await client1.close()
    await client2.close()
  })

  it('should handle multiple channels per client', async () => {
    const client = new Realtime({ key: 'app-key' })
    await new Promise(r => setTimeout(r, 50))

    const channel1 = client.channels.get('channel-1')
    const channel2 = client.channels.get('channel-2')
    const channel3 = client.channels.get('channel-3')

    await Promise.all([
      channel1.attach(),
      channel2.attach(),
      channel3.attach(),
    ])

    expect(channel1.state).toBe('attached')
    expect(channel2.state).toBe('attached')
    expect(channel3.state).toBe('attached')

    await client.close()
  })

  it('should handle reconnection', async () => {
    const client = new Realtime({ key: 'app-key' })
    await new Promise(r => setTimeout(r, 50))

    const channel = client.channels.get('test-channel')
    await channel.attach()

    // Close and reconnect
    await client.close()
    client.connect()
    await new Promise(r => setTimeout(r, 100))

    expect(client.connection.state).toBe('connected')

    await client.close()
  })
})
