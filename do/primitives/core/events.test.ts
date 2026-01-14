/**
 * Event emitter factory tests
 * @module primitives-core/events.test
 */
import { describe, test, expect, vi } from 'vitest'
import {
  createEventEmitter,
  EventEmitter,
  EventMap,
  EventHandler,
  EventSubscription,
} from './events'

// Test event types
interface TestEvents extends EventMap {
  message: { text: string }
  count: number
  empty: void
}

describe('createEventEmitter', () => {
  test('creates an EventEmitter instance', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(emitter).toBeInstanceOf(EventEmitter)
  })

  test('created emitter has on method', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(typeof emitter.on).toBe('function')
  })

  test('created emitter has emit method', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(typeof emitter.emit).toBe('function')
  })

  test('created emitter has off method', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(typeof emitter.off).toBe('function')
  })

  test('created emitter has once method', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(typeof emitter.once).toBe('function')
  })
})

describe('EventEmitter.on', () => {
  test('subscribes handler to event', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.emit('message', { text: 'hello' })

    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('returns subscription with id', () => {
    const emitter = createEventEmitter<TestEvents>()
    const subscription = emitter.on('message', () => {})

    expect(subscription.id).toBeDefined()
    expect(typeof subscription.id).toBe('string')
  })

  test('returns subscription with unsubscribe function', () => {
    const emitter = createEventEmitter<TestEvents>()
    const subscription = emitter.on('message', () => {})

    expect(typeof subscription.unsubscribe).toBe('function')
  })

  test('multiple handlers receive events', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)
    emitter.emit('message', { text: 'test' })

    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })
})

describe('EventEmitter.emit', () => {
  test('calls all subscribed handlers', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handlers = [vi.fn(), vi.fn(), vi.fn()]

    handlers.forEach(h => emitter.on('count', h))
    emitter.emit('count', 42)

    handlers.forEach(h => {
      expect(h).toHaveBeenCalledWith(42)
    })
  })

  test('does nothing if no handlers subscribed', () => {
    const emitter = createEventEmitter<TestEvents>()
    // Should not throw
    expect(() => emitter.emit('message', { text: 'hello' })).not.toThrow()
  })

  test('passes correct payload type', () => {
    const emitter = createEventEmitter<TestEvents>()
    let received: number | undefined

    emitter.on('count', (payload) => {
      received = payload
    })
    emitter.emit('count', 123)

    expect(received).toBe(123)
  })
})

describe('EventEmitter.off', () => {
  test('removes handler from event', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.off('message', handler)
    emitter.emit('message', { text: 'hello' })

    expect(handler).not.toHaveBeenCalled()
  })

  test('does not affect other handlers', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)
    emitter.off('message', handler1)
    emitter.emit('message', { text: 'test' })

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  test('handles removing non-existent handler', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    // Should not throw
    expect(() => emitter.off('message', handler)).not.toThrow()
  })
})

describe('EventEmitter.once', () => {
  test('handler fires only once', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.once('message', handler)
    emitter.emit('message', { text: 'first' })
    emitter.emit('message', { text: 'second' })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ text: 'first' })
  })

  test('returns subscription that can unsubscribe before firing', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    const subscription = emitter.once('message', handler)
    subscription.unsubscribe()
    emitter.emit('message', { text: 'hello' })

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('EventSubscription.unsubscribe', () => {
  test('removes handler when called', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    const subscription = emitter.on('message', handler)
    subscription.unsubscribe()
    emitter.emit('message', { text: 'hello' })

    expect(handler).not.toHaveBeenCalled()
  })

  test('is safe to call multiple times', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    const subscription = emitter.on('message', handler)
    subscription.unsubscribe()
    expect(() => subscription.unsubscribe()).not.toThrow()
  })
})

describe('EventEmitter.removeAllListeners', () => {
  test('removes all listeners for specific event', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)
    emitter.removeAllListeners('message')
    emitter.emit('message', { text: 'hello' })

    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })

  test('removes all listeners when no event specified', () => {
    const emitter = createEventEmitter<TestEvents>()
    const messageHandler = vi.fn()
    const countHandler = vi.fn()

    emitter.on('message', messageHandler)
    emitter.on('count', countHandler)
    emitter.removeAllListeners()
    emitter.emit('message', { text: 'hello' })
    emitter.emit('count', 42)

    expect(messageHandler).not.toHaveBeenCalled()
    expect(countHandler).not.toHaveBeenCalled()
  })

  test('does not affect other events when removing specific event', () => {
    const emitter = createEventEmitter<TestEvents>()
    const messageHandler = vi.fn()
    const countHandler = vi.fn()

    emitter.on('message', messageHandler)
    emitter.on('count', countHandler)
    emitter.removeAllListeners('message')
    emitter.emit('message', { text: 'hello' })
    emitter.emit('count', 42)

    expect(messageHandler).not.toHaveBeenCalled()
    expect(countHandler).toHaveBeenCalled()
  })
})

describe('EventEmitter.listenerCount', () => {
  test('returns 0 when no listeners', () => {
    const emitter = createEventEmitter<TestEvents>()
    expect(emitter.listenerCount('message')).toBe(0)
  })

  test('returns correct count', () => {
    const emitter = createEventEmitter<TestEvents>()
    emitter.on('message', () => {})
    emitter.on('message', () => {})
    emitter.on('message', () => {})

    expect(emitter.listenerCount('message')).toBe(3)
  })

  test('updates when listeners are removed', () => {
    const emitter = createEventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.on('message', () => {})
    expect(emitter.listenerCount('message')).toBe(2)

    emitter.off('message', handler)
    expect(emitter.listenerCount('message')).toBe(1)
  })
})

describe('EventEmitter async handlers', () => {
  test('emitAsync waits for all handlers', async () => {
    const emitter = createEventEmitter<TestEvents>()
    const results: number[] = []

    emitter.on('count', async (payload) => {
      await new Promise(r => setTimeout(r, 10))
      results.push(payload)
    })

    emitter.on('count', async (payload) => {
      await new Promise(r => setTimeout(r, 5))
      results.push(payload * 2)
    })

    await emitter.emitAsync('count', 5)

    expect(results).toContain(5)
    expect(results).toContain(10)
  })

  test('emitAsync returns when no handlers', async () => {
    const emitter = createEventEmitter<TestEvents>()
    await expect(emitter.emitAsync('count', 42)).resolves.toBeUndefined()
  })
})

describe('EventEmitter isolation', () => {
  test('different emitters are isolated', () => {
    const emitter1 = createEventEmitter<TestEvents>()
    const emitter2 = createEventEmitter<TestEvents>()
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    emitter1.on('message', handler1)
    emitter2.on('message', handler2)

    emitter1.emit('message', { text: 'from 1' })

    expect(handler1).toHaveBeenCalledWith({ text: 'from 1' })
    expect(handler2).not.toHaveBeenCalled()
  })
})
