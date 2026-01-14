/**
 * @dotdo/shared test suite
 *
 * RED phase: Tests written before implementation
 * Testing EventEmitter, TypedEventEmitter, and memory cleanup
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  EventEmitter,
  TypedEventEmitter,
  PusherEventEmitter,
  SocketIOEventEmitter,
  type EventHandler,
} from '../src'

// ============================================================================
// BASE EVENT EMITTER TESTS
// ============================================================================

describe('EventEmitter', () => {
  let emitter: EventEmitter

  beforeEach(() => {
    emitter = new EventEmitter()
  })

  describe('on/emit', () => {
    it('should register and call event handlers', () => {
      const handler = vi.fn()
      emitter.on('test', handler)
      emitter.emit('test', 'arg1', 'arg2')

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    })

    it('should support multiple handlers for same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)
      emitter.emit('test', 'data')

      expect(handler1).toHaveBeenCalledWith('data')
      expect(handler2).toHaveBeenCalledWith('data')
    })

    it('should support multiple events', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('event1', handler1)
      emitter.on('event2', handler2)

      emitter.emit('event1', 'data1')
      emitter.emit('event2', 'data2')

      expect(handler1).toHaveBeenCalledWith('data1')
      expect(handler2).toHaveBeenCalledWith('data2')
    })

    it('should return this for chaining', () => {
      const result = emitter.on('test', vi.fn())
      expect(result).toBe(emitter)
    })

    it('should emit newListener event when adding handlers', () => {
      const newListenerHandler = vi.fn()
      const testHandler = vi.fn()

      emitter.on('newListener', newListenerHandler)
      emitter.on('test', testHandler)

      expect(newListenerHandler).toHaveBeenCalledWith('test', testHandler)
    })
  })

  describe('off', () => {
    it('should remove a specific handler', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)
      emitter.off('test', handler1)
      emitter.emit('test')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should return this for chaining', () => {
      const handler = vi.fn()
      emitter.on('test', handler)
      const result = emitter.off('test', handler)
      expect(result).toBe(emitter)
    })

    it('should handle removing non-existent handler gracefully', () => {
      expect(() => emitter.off('nonexistent', vi.fn())).not.toThrow()
    })
  })

  describe('removeListener (alias for off)', () => {
    it('should work as alias for off', () => {
      const handler = vi.fn()
      emitter.on('test', handler)
      emitter.removeListener('test', handler)
      emitter.emit('test')

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('once', () => {
    it('should call handler only once', () => {
      const handler = vi.fn()
      emitter.once('test', handler)

      emitter.emit('test', 'first')
      emitter.emit('test', 'second')

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith('first')
    })

    it('should return this for chaining', () => {
      const result = emitter.once('test', vi.fn())
      expect(result).toBe(emitter)
    })

    it('should emit newListener event for once handlers', () => {
      const newListenerHandler = vi.fn()
      const onceHandler = vi.fn()

      emitter.on('newListener', newListenerHandler)
      emitter.once('test', onceHandler)

      expect(newListenerHandler).toHaveBeenCalledWith('test', onceHandler)
    })
  })

  describe('emit', () => {
    it('should return true when there are listeners', () => {
      emitter.on('test', vi.fn())
      expect(emitter.emit('test')).toBe(true)
    })

    it('should return false when there are no listeners', () => {
      expect(emitter.emit('test')).toBe(false)
    })

    it('should handle errors in handlers by emitting error event', () => {
      const errorHandler = vi.fn()
      const error = new Error('test error')

      emitter.on('error', errorHandler)
      emitter.on('test', () => {
        throw error
      })

      emitter.emit('test')

      expect(errorHandler).toHaveBeenCalledWith(error)
    })

    it('should not infinite loop when error handler throws', () => {
      // This tests that errors in the error handler don't cause recursion
      emitter.on('error', () => {
        throw new Error('error handler error')
      })
      emitter.on('test', () => {
        throw new Error('test error')
      })

      // Should not throw or infinite loop
      expect(() => emitter.emit('test')).not.toThrow()
    })
  })

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)
      emitter.removeAllListeners('test')
      emitter.emit('test')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })

    it('should remove all listeners when no event specified', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('event1', handler1)
      emitter.on('event2', handler2)
      emitter.removeAllListeners()

      emitter.emit('event1')
      emitter.emit('event2')

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).not.toHaveBeenCalled()
    })

    it('should return this for chaining', () => {
      const result = emitter.removeAllListeners()
      expect(result).toBe(emitter)
    })
  })

  describe('listenerCount', () => {
    it('should return correct count of listeners', () => {
      expect(emitter.listenerCount('test')).toBe(0)

      emitter.on('test', vi.fn())
      expect(emitter.listenerCount('test')).toBe(1)

      emitter.on('test', vi.fn())
      expect(emitter.listenerCount('test')).toBe(2)
    })

    it('should return 0 for unknown events', () => {
      expect(emitter.listenerCount('unknown')).toBe(0)
    })
  })

  describe('listeners', () => {
    it('should return array of listeners for event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)

      const listeners = emitter.listeners('test')
      expect(listeners).toContain(handler1)
      expect(listeners).toContain(handler2)
      expect(listeners).toHaveLength(2)
    })

    it('should return empty array for unknown events', () => {
      expect(emitter.listeners('unknown')).toEqual([])
    })
  })

  describe('memory cleanup', () => {
    it('should properly clean up after removeAllListeners', () => {
      for (let i = 0; i < 100; i++) {
        emitter.on(`event${i}`, vi.fn())
      }

      emitter.removeAllListeners()

      // Verify all handlers are cleaned up
      for (let i = 0; i < 100; i++) {
        expect(emitter.listenerCount(`event${i}`)).toBe(0)
      }
    })

    it('should clean up once listeners after they fire', () => {
      const handler = vi.fn()
      emitter.once('test', handler)

      expect(emitter.listenerCount('test')).toBe(1)
      emitter.emit('test')
      expect(emitter.listenerCount('test')).toBe(0)
    })
  })
})

// ============================================================================
// TYPED EVENT EMITTER TESTS
// ============================================================================

describe('TypedEventEmitter', () => {
  let emitter: TypedEventEmitter<{ message: string; count: number }>

  beforeEach(() => {
    emitter = new TypedEventEmitter()
  })

  describe('on', () => {
    it('should accept single event', () => {
      const handler = vi.fn()
      emitter.on('data', handler)
      ;(emitter as any)._emit('data', { message: 'hello', count: 1 })

      expect(handler).toHaveBeenCalledWith({ message: 'hello', count: 1 })
    })

    it('should accept array of events', () => {
      const handler = vi.fn()
      emitter.on(['event1', 'event2'], handler)

      ;(emitter as any)._emit('event1', { message: 'e1', count: 1 })
      ;(emitter as any)._emit('event2', { message: 'e2', count: 2 })

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('once', () => {
    it('should fire only once per event in array', () => {
      const handler = vi.fn()
      emitter.once(['event1', 'event2'], handler)

      ;(emitter as any)._emit('event1', { message: 'first', count: 1 })
      ;(emitter as any)._emit('event1', { message: 'second', count: 2 })
      ;(emitter as any)._emit('event2', { message: 'third', count: 3 })
      ;(emitter as any)._emit('event2', { message: 'fourth', count: 4 })

      // Once per event type = 2 calls total
      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  describe('off', () => {
    it('should remove all listeners when no args', () => {
      emitter.on('event1', vi.fn())
      emitter.on('event2', vi.fn())

      emitter.off()

      expect((emitter as any)._listeners.size).toBe(0)
    })

    it('should remove all listeners for specific event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('event1', handler1)
      emitter.on('event2', handler2)
      emitter.off('event1')

      ;(emitter as any)._emit('event1', { message: 't', count: 1 })
      ;(emitter as any)._emit('event2', { message: 't', count: 1 })

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should remove specific listener', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()

      emitter.on('test', handler1)
      emitter.on('test', handler2)
      emitter.off('test', handler1)

      ;(emitter as any)._emit('test', { message: 't', count: 1 })

      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should handle array of events', () => {
      const handler = vi.fn()
      emitter.on(['e1', 'e2', 'e3'], handler)
      emitter.off(['e1', 'e2'])

      ;(emitter as any)._emit('e1', { message: 't', count: 1 })
      ;(emitter as any)._emit('e2', { message: 't', count: 1 })
      ;(emitter as any)._emit('e3', { message: 't', count: 1 })

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// PUSHER EVENT EMITTER TESTS
// ============================================================================

describe('PusherEventEmitter', () => {
  let emitter: PusherEventEmitter

  beforeEach(() => {
    emitter = new PusherEventEmitter()
  })

  describe('bind/unbind', () => {
    it('should bind and trigger handlers', () => {
      const handler = vi.fn()
      emitter.bind('event', handler)
      ;(emitter as any)._emit('event', { data: 'test' })

      expect(handler).toHaveBeenCalledWith({ data: 'test' })
    })

    it('should return this for chaining', () => {
      expect(emitter.bind('test', vi.fn())).toBe(emitter)
      expect(emitter.unbind('test')).toBe(emitter)
    })

    it('should unbind all when no args', () => {
      emitter.bind('e1', vi.fn())
      emitter.bind('e2', vi.fn())
      emitter.unbind()

      expect((emitter as any)._listeners.size).toBe(0)
    })

    it('should unbind all for event when no callback', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.bind('test', h1)
      emitter.bind('test', h2)
      emitter.unbind('test')

      ;(emitter as any)._emit('test', 'data')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).not.toHaveBeenCalled()
    })

    it('should unbind specific callback', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.bind('test', h1)
      emitter.bind('test', h2)
      emitter.unbind('test', h1)

      ;(emitter as any)._emit('test', 'data')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).toHaveBeenCalled()
    })
  })

  describe('bind_global/unbind_global', () => {
    it('should call global listeners for all events', () => {
      const globalHandler = vi.fn()
      emitter.bind_global(globalHandler)

      ;(emitter as any)._emit('event1', 'data1')
      ;(emitter as any)._emit('event2', 'data2')

      expect(globalHandler).toHaveBeenCalledTimes(2)
      expect(globalHandler).toHaveBeenCalledWith('event1', 'data1')
      expect(globalHandler).toHaveBeenCalledWith('event2', 'data2')
    })

    it('should return this for chaining', () => {
      expect(emitter.bind_global(vi.fn())).toBe(emitter)
      expect(emitter.unbind_global()).toBe(emitter)
    })

    it('should unbind all global when no arg', () => {
      emitter.bind_global(vi.fn())
      emitter.bind_global(vi.fn())
      emitter.unbind_global()

      expect((emitter as any)._globalListeners.size).toBe(0)
    })

    it('should unbind specific global listener', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.bind_global(h1)
      emitter.bind_global(h2)
      emitter.unbind_global(h1)

      ;(emitter as any)._emit('test', 'data')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// SOCKET.IO EVENT EMITTER TESTS
// ============================================================================

describe('SocketIOEventEmitter', () => {
  let emitter: SocketIOEventEmitter

  beforeEach(() => {
    emitter = new SocketIOEventEmitter()
  })

  describe('on/off/once', () => {
    it('should handle standard event pattern', () => {
      const handler = vi.fn()
      emitter.on('test', handler)
      ;(emitter as any)._emit('test', 'arg1', 'arg2')

      expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    })

    it('should handle once events', () => {
      const handler = vi.fn()
      emitter.once('test', handler)

      ;(emitter as any)._emit('test', 'first')
      ;(emitter as any)._emit('test', 'second')

      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should off specific listener', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.on('test', h1)
      emitter.on('test', h2)
      emitter.off('test', h1)

      ;(emitter as any)._emit('test')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).toHaveBeenCalled()
    })

    it('should off all listeners for event when no callback', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.on('test', h1)
      emitter.once('test', h2)
      emitter.off('test')

      ;(emitter as any)._emit('test')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).not.toHaveBeenCalled()
    })
  })

  describe('removeAllListeners', () => {
    it('should remove all listeners for event', () => {
      emitter.on('test', vi.fn())
      emitter.once('test', vi.fn())
      emitter.removeAllListeners('test')

      expect(emitter.hasListeners('test')).toBe(false)
    })

    it('should remove all listeners when no event', () => {
      emitter.on('e1', vi.fn())
      emitter.on('e2', vi.fn())
      emitter.removeAllListeners()

      expect(emitter.hasListeners('e1')).toBe(false)
      expect(emitter.hasListeners('e2')).toBe(false)
    })
  })

  describe('listeners/hasListeners', () => {
    it('should return listeners for event', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.on('test', h1)
      emitter.once('test', h2)

      const listeners = emitter.listeners('test')
      expect(listeners).toContain(h1)
      expect(listeners).toContain(h2)
    })

    it('should return empty array for unknown event', () => {
      expect(emitter.listeners('unknown')).toEqual([])
    })

    it('should report hasListeners correctly', () => {
      expect(emitter.hasListeners('test')).toBe(false)
      emitter.on('test', vi.fn())
      expect(emitter.hasListeners('test')).toBe(true)
    })
  })

  describe('onAny/offAny', () => {
    it('should call onAny for all events', () => {
      const anyHandler = vi.fn()
      emitter.onAny(anyHandler)

      ;(emitter as any)._emit('event1', 'data1')
      ;(emitter as any)._emit('event2', 'data2')

      expect(anyHandler).toHaveBeenCalledTimes(2)
      expect(anyHandler).toHaveBeenCalledWith('event1', 'data1')
      expect(anyHandler).toHaveBeenCalledWith('event2', 'data2')
    })

    it('should prependAny at front', () => {
      const order: number[] = []
      emitter.onAny(() => order.push(1))
      emitter.prependAny(() => order.push(0))

      ;(emitter as any)._emit('test')

      expect(order).toEqual([0, 1])
    })

    it('should offAny specific listener', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.onAny(h1)
      emitter.onAny(h2)
      emitter.offAny(h1)

      ;(emitter as any)._emit('test')

      expect(h1).not.toHaveBeenCalled()
      expect(h2).toHaveBeenCalled()
    })

    it('should offAny all when no arg', () => {
      emitter.onAny(vi.fn())
      emitter.onAny(vi.fn())
      emitter.offAny()

      expect(emitter.listenersAny()).toEqual([])
    })

    it('should listenersAny return copy of listeners', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.onAny(h1)
      emitter.onAny(h2)

      const listeners = emitter.listenersAny()
      expect(listeners).toEqual([h1, h2])
    })
  })

  describe('onAnyOutgoing/offAnyOutgoing', () => {
    it('should prependAnyOutgoing at front', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.onAnyOutgoing(h1)
      emitter.prependAnyOutgoing(h2)

      expect(emitter.listenersAnyOutgoing()).toEqual([h2, h1])
    })

    it('should offAnyOutgoing specific listener', () => {
      const h1 = vi.fn()
      const h2 = vi.fn()
      emitter.onAnyOutgoing(h1)
      emitter.onAnyOutgoing(h2)
      emitter.offAnyOutgoing(h1)

      expect(emitter.listenersAnyOutgoing()).toEqual([h2])
    })

    it('should offAnyOutgoing all when no arg', () => {
      emitter.onAnyOutgoing(vi.fn())
      emitter.offAnyOutgoing()

      expect(emitter.listenersAnyOutgoing()).toEqual([])
    })
  })
})

// ============================================================================
// TYPE SAFETY TESTS (compile-time, runtime validation)
// ============================================================================

describe('Type Safety', () => {
  it('EventHandler type accepts any args', () => {
    const handler: EventHandler = (...args) => {
      expect(args).toBeDefined()
    }

    handler('string', 123, { obj: true })
  })

  it('TypedEventEmitter preserves type information at runtime', () => {
    interface MyEvents {
      message: string
      count: number
    }

    const emitter = new TypedEventEmitter<MyEvents>()
    const receivedData: MyEvents[] = []

    emitter.on('data', (data) => {
      receivedData.push(data)
    })

    ;(emitter as any)._emit('data', { message: 'test', count: 42 })

    expect(receivedData[0]).toEqual({ message: 'test', count: 42 })
  })
})
