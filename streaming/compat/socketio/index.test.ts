/**
 * @dotdo/socketio - Socket.IO SDK compat tests
 *
 * Tests for socket.io-client API compatibility backed by DO storage:
 * - Connection (connect, disconnect, reconnect)
 * - Events (on, off, once, emit)
 * - Acknowledgements (emit with callback)
 * - Timeouts (socket.timeout().emit())
 * - Rooms (join, leave, to, broadcast)
 * - Namespaces (/admin, /chat)
 * - Manager (multiplexing, reconnection)
 *
 * @see https://socket.io/docs/v4/client-api/
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { io, Manager, Socket, protocol, _clearAll } from './socketio'
import { SocketIOError, ConnectionError, TimeoutError } from './types'
import type { SocketOptions, EventCallback } from './types'

// ============================================================================
// CONNECTION TESTS
// ============================================================================

describe('io() factory', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should create socket with no arguments', () => {
    const socket = io()
    expect(socket).toBeDefined()
    expect(socket.nsp).toBe('/')
  })

  it('should create socket with URL', () => {
    const socket = io('ws://localhost:3000')
    expect(socket).toBeDefined()
  })

  it('should create socket with URL and options', () => {
    const socket = io('ws://localhost:3000', { auth: { token: 'abc' } })
    expect(socket).toBeDefined()
  })

  it('should create socket with options only', () => {
    const socket = io({ auth: { token: 'abc' } })
    expect(socket).toBeDefined()
  })

  it('should parse namespace from URL', () => {
    const socket = io('ws://localhost:3000/admin')
    expect(socket.nsp).toBe('/admin')
  })

  it('should create socket for namespace-only URI', () => {
    const socket = io('/admin')
    expect(socket.nsp).toBe('/admin')
  })

  it('should reuse manager for same URI', () => {
    const socket1 = io('ws://localhost:3000')
    const socket2 = io('ws://localhost:3000')
    expect(socket1.io).toBe(socket2.io)
  })

  it('should create new manager with forceNew option', () => {
    const socket1 = io('ws://localhost:3000')
    const socket2 = io('ws://localhost:3000', { forceNew: true })
    expect(socket1.io).not.toBe(socket2.io)
  })

  it('should have protocol version', () => {
    expect(protocol).toBe(5)
    expect(io.protocol).toBe(5)
  })

  it('should expose Manager and Socket classes', () => {
    expect(io.Manager).toBeDefined()
    expect(io.Socket).toBeDefined()
  })
})

// ============================================================================
// SOCKET CONNECTION TESTS
// ============================================================================

describe('Socket connection', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should auto-connect by default', async () => {
    const socket = io()

    // Wait for async connection
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.connected).toBe(true)
    expect(socket.disconnected).toBe(false)
    expect(socket.id).toBeDefined()
    expect(socket.id.length).toBeGreaterThan(0)
  })

  it('should not auto-connect when autoConnect is false', async () => {
    const socket = io({ autoConnect: false })

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.connected).toBe(false)
    expect(socket.disconnected).toBe(true)
  })

  it('should connect manually', async () => {
    const socket = io({ autoConnect: false })

    expect(socket.connected).toBe(false)

    socket.connect()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.connected).toBe(true)
  })

  it('should emit connect event', async () => {
    const socket = io({ autoConnect: false })
    const onConnect = vi.fn()

    socket.on('connect', onConnect)
    socket.connect()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(onConnect).toHaveBeenCalled()
  })

  it('should disconnect', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.connected).toBe(true)

    socket.disconnect()

    expect(socket.connected).toBe(false)
    expect(socket.disconnected).toBe(true)
  })

  it('should emit disconnect event', async () => {
    const socket = io()
    const onDisconnect = vi.fn()

    socket.on('disconnect', onDisconnect)

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.disconnect()

    expect(onDisconnect).toHaveBeenCalledWith('io client disconnect')
  })

  it('should support open() and close() aliases', async () => {
    const socket = io({ autoConnect: false })

    socket.open()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(socket.connected).toBe(true)

    socket.close()
    expect(socket.connected).toBe(false)
  })

  it('should join default room on connect', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.rooms.has(socket.id)).toBe(true)
  })
})

// ============================================================================
// EVENT HANDLING TESTS
// ============================================================================

describe('Event handling', () => {
  afterEach(() => {
    _clearAll()
  })

  describe('on/off', () => {
    it('should register event listener with on()', async () => {
      const socket = io()
      const callback = vi.fn()

      socket.on('custom', callback)

      await new Promise(resolve => setTimeout(resolve, 10))

      // Simulate receiving a message
      ;(socket as any)._receiveMessage('custom', 'data')

      expect(callback).toHaveBeenCalledWith('data')
    })

    it('should remove event listener with off()', async () => {
      const socket = io()
      const callback = vi.fn()

      socket.on('custom', callback)
      socket.off('custom', callback)

      await new Promise(resolve => setTimeout(resolve, 10))

      ;(socket as any)._receiveMessage('custom', 'data')

      expect(callback).not.toHaveBeenCalled()
    })

    it('should remove all listeners for event with off(event)', async () => {
      const socket = io()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      socket.on('custom', callback1)
      socket.on('custom', callback2)
      socket.off('custom')

      await new Promise(resolve => setTimeout(resolve, 10))

      ;(socket as any)._receiveMessage('custom', 'data')

      expect(callback1).not.toHaveBeenCalled()
      expect(callback2).not.toHaveBeenCalled()
    })

    it('should support addEventListener/removeEventListener aliases', async () => {
      const socket = io()
      const callback = vi.fn()

      socket.addEventListener('custom', callback)

      await new Promise(resolve => setTimeout(resolve, 10))

      ;(socket as any)._receiveMessage('custom', 'data')
      expect(callback).toHaveBeenCalled()

      callback.mockClear()
      socket.removeEventListener('custom', callback)

      ;(socket as any)._receiveMessage('custom', 'data')
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('once', () => {
    it('should call listener only once', async () => {
      const socket = io()
      const callback = vi.fn()

      socket.once('custom', callback)

      await new Promise(resolve => setTimeout(resolve, 10))

      ;(socket as any)._receiveMessage('custom', 'first')
      ;(socket as any)._receiveMessage('custom', 'second')

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith('first')
    })
  })

  describe('listeners/hasListeners', () => {
    it('should return listeners for event', async () => {
      const socket = io()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      socket.on('custom', callback1)
      socket.on('custom', callback2)

      const listeners = socket.listeners('custom')
      expect(listeners).toHaveLength(2)
      expect(listeners).toContain(callback1)
      expect(listeners).toContain(callback2)
    })

    it('should check if listeners exist', async () => {
      const socket = io()

      expect(socket.hasListeners('custom')).toBe(false)

      socket.on('custom', vi.fn())

      expect(socket.hasListeners('custom')).toBe(true)
    })
  })

  describe('removeAllListeners', () => {
    it('should remove all listeners for event', async () => {
      const socket = io()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      socket.on('event1', callback1)
      socket.on('event2', callback2)

      socket.removeAllListeners('event1')

      expect(socket.hasListeners('event1')).toBe(false)
      expect(socket.hasListeners('event2')).toBe(true)
    })

    it('should remove all listeners when no event specified', async () => {
      const socket = io()

      socket.on('event1', vi.fn())
      socket.on('event2', vi.fn())

      socket.removeAllListeners()

      expect(socket.hasListeners('event1')).toBe(false)
      expect(socket.hasListeners('event2')).toBe(false)
    })
  })

  describe('onAny/offAny', () => {
    it('should call catch-all listener for any event', async () => {
      const socket = io()

      await new Promise(resolve => setTimeout(resolve, 10))

      // Register after connect to avoid catching the connect event
      const callback = vi.fn()
      socket.onAny(callback)

      ;(socket as any)._receiveMessage('event1', 'data1')
      ;(socket as any)._receiveMessage('event2', 'data2')

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith('event1', 'data1')
      expect(callback).toHaveBeenCalledWith('event2', 'data2')
    })

    it('should remove catch-all listener with offAny', async () => {
      const socket = io()
      const callback = vi.fn()

      socket.onAny(callback)
      socket.offAny(callback)

      await new Promise(resolve => setTimeout(resolve, 10))

      ;(socket as any)._receiveMessage('event1', 'data1')

      expect(callback).not.toHaveBeenCalled()
    })

    it('should prepend catch-all listener', async () => {
      const socket = io()

      await new Promise(resolve => setTimeout(resolve, 10))

      // Register after connect to avoid catching the connect event
      const order: string[] = []
      socket.onAny(() => order.push('first'))
      socket.prependAny(() => order.push('prepended'))

      ;(socket as any)._receiveMessage('event', 'data')

      expect(order).toEqual(['prepended', 'first'])
    })

    it('should return all catch-all listeners', async () => {
      const socket = io()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      socket.onAny(callback1)
      socket.onAny(callback2)

      const listeners = socket.listenersAny()
      expect(listeners).toHaveLength(2)
    })
  })

  describe('onAnyOutgoing/offAnyOutgoing', () => {
    it('should call outgoing catch-all listener for any emit', async () => {
      const socket = io()
      const callback = vi.fn()

      await new Promise(resolve => setTimeout(resolve, 10))

      socket.onAnyOutgoing(callback)

      socket.emit('event1', 'data1')
      socket.emit('event2', 'data2')

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith('event1', 'data1')
      expect(callback).toHaveBeenCalledWith('event2', 'data2')
    })
  })
})

// ============================================================================
// EMIT TESTS
// ============================================================================

describe('emit', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should emit events', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should not throw
    socket.emit('custom', 'data')
    socket.emit('custom', { key: 'value' })
    socket.emit('custom', 1, 2, 3)
  })

  it('should buffer events when not connected', async () => {
    const socket = io({ autoConnect: false })
    const outgoing = vi.fn()

    socket.onAnyOutgoing(outgoing)

    // Emit while disconnected
    socket.emit('event', 'data')

    // Should be buffered, not emitted yet
    expect(outgoing).not.toHaveBeenCalled()

    // Connect
    socket.connect()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Should have flushed buffer
    expect(outgoing).toHaveBeenCalledWith('event', 'data')
  })

  it('should support send() and write() aliases', async () => {
    const socket = io()
    const outgoing = vi.fn()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.onAnyOutgoing(outgoing)

    socket.send('data1')
    socket.write('data2')

    expect(outgoing).toHaveBeenCalledWith('message', 'data1')
    expect(outgoing).toHaveBeenCalledWith('message', 'data2')
  })
})

// ============================================================================
// ACKNOWLEDGEMENT TESTS
// ============================================================================

describe('Acknowledgements', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should emit with callback acknowledgement', async () => {
    const socket = io()
    const callback = vi.fn()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.emit('action', { type: 'test' }, callback)

    // Wait for simulated server response
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(callback).toHaveBeenCalled()
  })

  it('should pass data through acknowledgement', async () => {
    const socket = io()
    const callback = vi.fn()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.emit('action', 'test-data', callback)

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(callback).toHaveBeenCalledWith('test-data')
  })

  it('should support emitWithAck for promise-based acks', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    const result = await socket.emitWithAck('action', 'test-data')

    expect(result).toBe('test-data')
  })
})

// ============================================================================
// TIMEOUT TESTS
// ============================================================================

describe('Timeouts', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should emit with timeout using callback', async () => {
    const socket = io()
    const callback = vi.fn()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.timeout(5000).emit('action', 'data', callback)

    // Wait for simulated server response (should be faster than timeout)
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(callback).toHaveBeenCalledWith(null, 'data')
  })

  it('should timeout with error-first callback', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Use a very short timeout that will expire
    const result = await new Promise<[Error | null, unknown]>(resolve => {
      // Mock a slow response by using a socket that won't respond quickly
      const slowSocket = io({ autoConnect: false })
      slowSocket.connect()

      setTimeout(() => {
        slowSocket.timeout(1).emit('action', 'data', (err: Error | null, data: unknown) => {
          resolve([err, data])
        })
      }, 20)
    })

    // The timeout should trigger an error
    // Note: In our simulation, the server responds within 10ms, so with a 1ms timeout we should get an error
    expect(result[0]).toBeInstanceOf(TimeoutError)
  })

  it('should support emitWithAck with timeout', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    const result = await socket.timeout(5000).emitWithAck('action', 'data')

    expect(result).toBe('data')
  })
})

// ============================================================================
// ROOM TESTS
// ============================================================================

describe('Rooms', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should join a room', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join('room1')

    expect(socket.rooms.has('room1')).toBe(true)
  })

  it('should join multiple rooms', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join(['room1', 'room2', 'room3'])

    expect(socket.rooms.has('room1')).toBe(true)
    expect(socket.rooms.has('room2')).toBe(true)
    expect(socket.rooms.has('room3')).toBe(true)
  })

  it('should leave a room', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join('room1')
    expect(socket.rooms.has('room1')).toBe(true)

    socket.leave('room1')
    expect(socket.rooms.has('room1')).toBe(false)
  })

  it('should emit to specific room with to()', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join('room1')

    // Should not throw
    const result = socket.to('room1').emit('message', 'Hello room!')
    expect(result).toBe(true)
  })

  it('should emit to multiple rooms', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join(['room1', 'room2'])

    const result = socket.to(['room1', 'room2']).emit('message', 'Hello rooms!')
    expect(result).toBe(true)
  })

  it('should support in() as alias for to()', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join('room1')

    const result = socket.in('room1').emit('message', 'Hello!')
    expect(result).toBe(true)
  })

  it('should exclude rooms with except()', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    socket.join(['room1', 'room2', 'room3'])

    // Should emit to room1 and room3, but not room2
    const result = socket.to(['room1', 'room2', 'room3']).except('room2').emit('message', 'Hello!')
    expect(result).toBe(true)
  })

  it('should support broadcast property', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should not throw
    const result = socket.broadcast.emit('message', 'Hello everyone!')
    expect(result).toBe(true)
  })
})

// ============================================================================
// NAMESPACE TESTS
// ============================================================================

describe('Namespaces', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should connect to default namespace', () => {
    const socket = io('ws://localhost:3000')
    expect(socket.nsp).toBe('/')
  })

  it('should connect to custom namespace via URL', () => {
    const socket = io('ws://localhost:3000/admin')
    expect(socket.nsp).toBe('/admin')
  })

  it('should connect to custom namespace via option', () => {
    const socket = io('ws://localhost:3000', { nsp: '/admin' })
    expect(socket.nsp).toBe('/admin')
  })

  it('should connect to namespace-only URI', () => {
    const socket = io('/admin')
    expect(socket.nsp).toBe('/admin')
  })

  it('should create separate sockets for different namespaces', () => {
    const socket1 = io('ws://localhost:3000/')
    const socket2 = io('ws://localhost:3000/admin')

    expect(socket1.nsp).toBe('/')
    expect(socket2.nsp).toBe('/admin')
    expect(socket1).not.toBe(socket2)
  })

  it('should share manager across namespaces', () => {
    const socket1 = io('ws://localhost:3000/')
    const socket2 = io('ws://localhost:3000/admin')

    expect(socket1.io).toBe(socket2.io)
  })
})

// ============================================================================
// MANAGER TESTS
// ============================================================================

describe('Manager', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should create manager with options', () => {
    const manager = new Manager('ws://localhost:3000', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
    })

    expect(manager.reconnection).toBe(true)
    expect(manager.reconnectionAttempts).toBe(5)
    expect(manager.reconnectionDelay).toBe(1000)
    expect(manager.timeout).toBe(20000)
  })

  it('should have default options', () => {
    const manager = new Manager()

    expect(manager.reconnection).toBe(true)
    expect(manager.reconnectionAttempts).toBe(Infinity)
    expect(manager.reconnectionDelay).toBe(1000)
    expect(manager.reconnectionDelayMax).toBe(5000)
    expect(manager.randomizationFactor).toBe(0.5)
    expect(manager.timeout).toBe(20000)
  })

  it('should create socket for namespace', () => {
    const manager = new Manager('ws://localhost:3000')
    const socket = manager.socket('/admin')

    expect(socket).toBeDefined()
    expect(socket.nsp).toBe('/admin')
  })

  it('should reuse socket for same namespace', () => {
    const manager = new Manager('ws://localhost:3000')
    const socket1 = manager.socket('/admin')
    const socket2 = manager.socket('/admin')

    expect(socket1).toBe(socket2)
  })

  it('should close all sockets', async () => {
    const manager = new Manager('ws://localhost:3000')
    const socket1 = manager.socket('/')
    const socket2 = manager.socket('/admin')

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket1.connected).toBe(true)
    expect(socket2.connected).toBe(true)

    manager.close()

    expect(socket1.connected).toBe(false)
    expect(socket2.connected).toBe(false)
  })

  it('should support disconnect() alias', () => {
    const manager = new Manager()
    // Should not throw
    manager.disconnect()
  })

  it('should support open/connect', () => {
    const manager = new Manager()
    const callback = vi.fn()

    manager.open(callback)

    // Callback should be called asynchronously
    expect(callback).not.toHaveBeenCalled()
  })
})

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

describe('Compression', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should support compress option', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should return this for chaining
    const result = socket.compress(false)
    expect(result).toBe(socket)
  })
})

// ============================================================================
// VOLATILE TESTS
// ============================================================================

describe('Volatile', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should support volatile property', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Should return this for chaining
    const result = socket.volatile
    expect(result).toBe(socket)
  })
})

// ============================================================================
// MIDDLEWARE TESTS
// ============================================================================

describe('Middleware', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should run middleware on incoming events', async () => {
    const socket = io()
    const middleware = vi.fn((packet, next) => next())

    socket.use(middleware)

    await new Promise(resolve => setTimeout(resolve, 10))

    ;(socket as any)._receiveMessage('event', 'data')

    expect(middleware).toHaveBeenCalled()
  })

  it('should allow middleware to modify/block events', async () => {
    const socket = io()
    const listener = vi.fn()

    // Middleware that blocks events
    socket.use((packet, next) => {
      if (packet[0] === 'blocked') {
        // Don't call next - event is blocked
      } else {
        next()
      }
    })

    socket.on('blocked', listener)
    socket.on('allowed', listener)

    await new Promise(resolve => setTimeout(resolve, 10))

    ;(socket as any)._receiveMessage('blocked', 'data')
    ;(socket as any)._receiveMessage('allowed', 'data')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('data')
  })

  it('should handle middleware errors', async () => {
    const socket = io()
    const errorHandler = vi.fn()

    socket.use((packet, next) => {
      next(new Error('middleware error'))
    })

    socket.on('error', errorHandler)

    await new Promise(resolve => setTimeout(resolve, 10))

    ;(socket as any)._receiveMessage('event', 'data')

    expect(errorHandler).toHaveBeenCalled()
  })
})

// ============================================================================
// AUTH TESTS
// ============================================================================

describe('Authentication', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should accept auth option as object', () => {
    const socket = io({ auth: { token: 'abc123' } })
    expect(socket.auth).toEqual({ token: 'abc123' })
  })

  it('should accept auth option as function', () => {
    const authFn = (cb: (data: Record<string, unknown>) => void) => {
      cb({ token: 'abc123' })
    }
    const socket = io({ auth: authFn })
    expect(socket.auth).toBe(authFn)
  })

  it('should allow setting auth after creation', () => {
    const socket = io()
    socket.auth = { token: 'xyz789' }
    expect(socket.auth).toEqual({ token: 'xyz789' })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling', () => {
  it('should create SocketIOError', () => {
    const error = new SocketIOError('test error')
    expect(error.name).toBe('SocketIOError')
    expect(error.message).toBe('test error')
  })

  it('should create ConnectionError', () => {
    const error = new ConnectionError('connection failed', 'network issue')
    expect(error.name).toBe('ConnectionError')
    expect(error.message).toBe('connection failed')
    expect(error.description).toBe('network issue')
    expect(error.type).toBe('TransportError')
  })

  it('should create TimeoutError', () => {
    const error = new TimeoutError()
    expect(error.name).toBe('TimeoutError')
    expect(error.message).toBe('operation timed out')
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should work with typical chat application flow', async () => {
    const socket = io('ws://localhost:3000', {
      auth: { user: 'testuser' },
    })

    const events: string[] = []

    socket.on('connect', () => {
      events.push('connected')
      socket.join('lobby')
      socket.emit('join-room', 'lobby')
    })

    socket.on('message', (data) => {
      events.push(`message:${data}`)
    })

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(events).toContain('connected')
    expect(socket.rooms.has('lobby')).toBe(true)

    // Send a message to room
    socket.to('lobby').emit('message', 'Hello lobby!')

    socket.disconnect()
  })

  it('should work with acknowledgement workflow', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    // Action with acknowledgement
    const result = await socket.emitWithAck('createItem', { name: 'Test Item' })

    expect(result).toEqual({ name: 'Test Item' })

    socket.disconnect()
  })

  it('should work with multiple namespaces', async () => {
    const mainSocket = io('ws://localhost:3000/')
    const adminSocket = io('ws://localhost:3000/admin')

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(mainSocket.connected).toBe(true)
    expect(adminSocket.connected).toBe(true)

    expect(mainSocket.nsp).toBe('/')
    expect(adminSocket.nsp).toBe('/admin')

    // Same manager
    expect(mainSocket.io).toBe(adminSocket.io)

    // Disconnect both
    mainSocket.io.close()

    expect(mainSocket.connected).toBe(false)
    expect(adminSocket.connected).toBe(false)
  })

  it('should work with room-based broadcast', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    // Both join same room
    socket1.join('gameRoom')
    socket2.join('gameRoom')

    // Broadcast to room (excluding self)
    socket1.to('gameRoom').emit('playerMove', { x: 10, y: 20 })

    // Cleanup
    socket1.disconnect()
    socket2.disconnect()
  })
})

// ============================================================================
// ROOM BROADCAST DELIVERY TESTS
// ============================================================================

describe('Room broadcast delivery', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should deliver room broadcast to other sockets in the room', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('room1')
    socket2.join('room1')

    const received: string[] = []
    socket2.on('message', (data) => received.push(data as string))

    socket1.to('room1').emit('message', 'hello')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received).toContain('hello')

    socket1.disconnect()
    socket2.disconnect()
  })

  it('should NOT deliver to sockets not in the room', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })
    const socket3 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('room1')
    socket2.join('room1')
    // socket3 does NOT join room1

    const received2: string[] = []
    const received3: string[] = []
    socket2.on('message', (data) => received2.push(data as string))
    socket3.on('message', (data) => received3.push(data as string))

    socket1.to('room1').emit('message', 'hello2')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received2).toContain('hello2')
    expect(received3).toHaveLength(0) // socket3 not in room

    socket1.disconnect()
    socket2.disconnect()
    socket3.disconnect()
  })

  it('should NOT deliver to the sender when using to()', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('room1')
    socket2.join('room1')

    const received1: string[] = []
    const received2: string[] = []
    socket1.on('message', (data) => received1.push(data as string))
    socket2.on('message', (data) => received2.push(data as string))

    socket1.to('room1').emit('message', 'broadcast')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received1).toHaveLength(0) // sender should not receive
    expect(received2).toContain('broadcast')

    socket1.disconnect()
    socket2.disconnect()
  })

  it('should deliver broadcast.emit to all sockets except sender', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('common')
    socket2.join('common')

    const received1: string[] = []
    const received2: string[] = []
    socket1.on('announcement', (data) => received1.push(data as string))
    socket2.on('announcement', (data) => received2.push(data as string))

    socket1.broadcast.emit('announcement', 'hello all')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received1).toHaveLength(0) // sender excluded
    expect(received2).toContain('hello all')

    socket1.disconnect()
    socket2.disconnect()
  })

  it('should return sockets with fetchSockets()', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })
    const socket3 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('room1')
    socket2.join('room1')
    // socket3 does NOT join room1

    const sockets = await socket1.in('room1').fetchSockets()

    expect(sockets).toHaveLength(2)
    expect(sockets.map((s: any) => s.id)).toContain(socket1.id)
    expect(sockets.map((s: any) => s.id)).toContain(socket2.id)
    expect(sockets.map((s: any) => s.id)).not.toContain(socket3.id)

    socket1.disconnect()
    socket2.disconnect()
    socket3.disconnect()
  })

  it('should handle multiple rooms correctly', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })
    const socket3 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('roomA')
    socket2.join(['roomA', 'roomB'])
    socket3.join('roomB')

    const received1: string[] = []
    const received2: string[] = []
    const received3: string[] = []
    socket1.on('msg', (data) => received1.push(data as string))
    socket2.on('msg', (data) => received2.push(data as string))
    socket3.on('msg', (data) => received3.push(data as string))

    // Emit to roomB only
    socket1.to('roomB').emit('msg', 'to-roomB')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received1).toHaveLength(0) // socket1 not in roomB
    expect(received2).toContain('to-roomB') // socket2 in roomB
    expect(received3).toContain('to-roomB') // socket3 in roomB

    socket1.disconnect()
    socket2.disconnect()
    socket3.disconnect()
  })

  it('should handle except() to exclude rooms', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })
    const socket3 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('main')
    socket2.join(['main', 'vip'])
    socket3.join('main')

    const received1: string[] = []
    const received2: string[] = []
    const received3: string[] = []
    socket1.on('msg', (data) => received1.push(data as string))
    socket2.on('msg', (data) => received2.push(data as string))
    socket3.on('msg', (data) => received3.push(data as string))

    // Emit to main except vip
    socket1.to('main').except('vip').emit('msg', 'not-for-vip')
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(received1).toHaveLength(0) // sender excluded
    expect(received2).toHaveLength(0) // socket2 is in 'vip' room, should be excluded
    expect(received3).toContain('not-for-vip') // socket3 in main, not in vip

    socket1.disconnect()
    socket2.disconnect()
    socket3.disconnect()
  })

  it('should clean up room membership on disconnect', async () => {
    const socket1 = io('ws://localhost:3000', { forceNew: true })
    const socket2 = io('ws://localhost:3000', { forceNew: true })

    await new Promise(resolve => setTimeout(resolve, 10))

    socket1.join('room1')
    socket2.join('room1')

    // Verify both are in room
    let sockets = await socket1.in('room1').fetchSockets()
    expect(sockets).toHaveLength(2)

    // Disconnect socket2
    socket2.disconnect()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Now only socket1 should be in room
    sockets = await socket1.in('room1').fetchSockets()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].id).toBe(socket1.id)

    socket1.disconnect()
  })
})

// ============================================================================
// RECOVERED/ACTIVE STATE TESTS
// ============================================================================

describe('State properties', () => {
  afterEach(() => {
    _clearAll()
  })

  it('should have recovered property', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.recovered).toBe(false)
  })

  it('should have active property (alias for connected)', async () => {
    const socket = io()

    await new Promise(resolve => setTimeout(resolve, 10))

    expect(socket.active).toBe(socket.connected)

    socket.disconnect()

    expect(socket.active).toBe(socket.connected)
  })
})
