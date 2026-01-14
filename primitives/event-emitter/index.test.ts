import { describe, test, expect, vi, beforeEach } from 'vitest'
import { EventEmitter, BufferedEmitter, FilteredEmitter, EventBus, createEventBus, EventHistory } from './index'

// Define test event map
interface TestEvents {
  message: { text: string }
  count: number
  empty: void
  user: { id: string; name: string }
}

describe('EventEmitter', () => {
  describe('basic on/emit/off', () => {
    test('emits event to subscribed handler', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.on('message', handler)
      emitter.emit('message', { text: 'hello' })

      expect(handler).toHaveBeenCalledWith({ text: 'hello' })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    test('handler receives correct payload type', () => {
      const emitter = new EventEmitter<TestEvents>()
      let received: number | undefined

      emitter.on('count', (payload) => {
        received = payload
      })
      emitter.emit('count', 42)

      expect(received).toBe(42)
    })

    test('unsubscribes handler with off()', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.on('message', handler)
      emitter.off('message', handler)
      emitter.emit('message', { text: 'hello' })

      expect(handler).not.toHaveBeenCalled()
    })

    test('returns subscription with unsubscribe function', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      const subscription = emitter.on('message', handler)
      expect(subscription.id).toBeDefined()
      expect(typeof subscription.unsubscribe).toBe('function')

      subscription.unsubscribe()
      emitter.emit('message', { text: 'hello' })

      expect(handler).not.toHaveBeenCalled()
    })

    test('handles void payload events', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.on('empty', handler)
      emitter.emit('empty', undefined as void)

      expect(handler).toHaveBeenCalledWith(undefined)
    })
  })

  describe('once listeners', () => {
    test('once() handler fires only once', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.once('message', handler)
      emitter.emit('message', { text: 'first' })
      emitter.emit('message', { text: 'second' })

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith({ text: 'first' })
    })

    test('once() returns subscription that can unsubscribe before firing', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      const subscription = emitter.once('message', handler)
      subscription.unsubscribe()
      emitter.emit('message', { text: 'hello' })

      expect(handler).not.toHaveBeenCalled()
    })

    test('on() with once option behaves like once()', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.on('message', handler, { once: true })
      emitter.emit('message', { text: 'first' })
      emitter.emit('message', { text: 'second' })

      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('emitAsync', () => {
    test('emitAsync waits for all async handlers to complete', async () => {
      const emitter = new EventEmitter<TestEvents>()
      const results: number[] = []

      emitter.on('count', async (payload) => {
        await new Promise((r) => setTimeout(r, 10))
        results.push(payload)
      })

      emitter.on('count', async (payload) => {
        await new Promise((r) => setTimeout(r, 5))
        results.push(payload * 2)
      })

      await emitter.emitAsync('count', 5)

      expect(results).toContain(5)
      expect(results).toContain(10)
      expect(results.length).toBe(2)
    })

    test('emitAsync returns when no handlers exist', async () => {
      const emitter = new EventEmitter<TestEvents>()
      await expect(emitter.emitAsync('count', 42)).resolves.toBeUndefined()
    })

    test('emitAsync propagates handler errors', async () => {
      const emitter = new EventEmitter<TestEvents>()

      emitter.on('message', async () => {
        throw new Error('handler error')
      })

      await expect(emitter.emitAsync('message', { text: 'test' })).rejects.toThrow('handler error')
    })
  })

  describe('removeAllListeners', () => {
    test('removes all listeners for a specific event', () => {
      const emitter = new EventEmitter<TestEvents>()
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
      const emitter = new EventEmitter<TestEvents>()
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
      const emitter = new EventEmitter<TestEvents>()
      const messageHandler = vi.fn()
      const countHandler = vi.fn()

      emitter.on('message', messageHandler)
      emitter.on('count', countHandler)
      emitter.removeAllListeners('message')
      emitter.emit('message', { text: 'hello' })
      emitter.emit('count', 42)

      expect(messageHandler).not.toHaveBeenCalled()
      expect(countHandler).toHaveBeenCalledWith(42)
    })
  })

  describe('listenerCount', () => {
    test('returns 0 when no listeners exist', () => {
      const emitter = new EventEmitter<TestEvents>()
      expect(emitter.listenerCount('message')).toBe(0)
    })

    test('returns correct count of listeners', () => {
      const emitter = new EventEmitter<TestEvents>()
      emitter.on('message', () => {})
      emitter.on('message', () => {})
      emitter.on('message', () => {})

      expect(emitter.listenerCount('message')).toBe(3)
    })

    test('updates count when listeners are removed', () => {
      const emitter = new EventEmitter<TestEvents>()
      const handler = vi.fn()

      emitter.on('message', handler)
      emitter.on('message', () => {})
      expect(emitter.listenerCount('message')).toBe(2)

      emitter.off('message', handler)
      expect(emitter.listenerCount('message')).toBe(1)
    })
  })

  describe('priority ordering', () => {
    test('handlers execute in priority order (higher first)', () => {
      const emitter = new EventEmitter<TestEvents>()
      const order: string[] = []

      emitter.on('message', () => order.push('low'), { priority: 1 })
      emitter.on('message', () => order.push('high'), { priority: 10 })
      emitter.on('message', () => order.push('medium'), { priority: 5 })

      emitter.emit('message', { text: 'test' })

      expect(order).toEqual(['high', 'medium', 'low'])
    })

    test('handlers with same priority maintain insertion order', () => {
      const emitter = new EventEmitter<TestEvents>()
      const order: string[] = []

      emitter.on('message', () => order.push('first'), { priority: 5 })
      emitter.on('message', () => order.push('second'), { priority: 5 })
      emitter.on('message', () => order.push('third'), { priority: 5 })

      emitter.emit('message', { text: 'test' })

      expect(order).toEqual(['first', 'second', 'third'])
    })

    test('handlers without priority default to 0', () => {
      const emitter = new EventEmitter<TestEvents>()
      const order: string[] = []

      emitter.on('message', () => order.push('default'))
      emitter.on('message', () => order.push('positive'), { priority: 1 })
      emitter.on('message', () => order.push('negative'), { priority: -1 })

      emitter.emit('message', { text: 'test' })

      expect(order).toEqual(['positive', 'default', 'negative'])
    })
  })

  describe('wildcard listeners', () => {
    test('wildcard handler receives all events', () => {
      const emitter = new EventEmitter<TestEvents>()
      const wildcardHandler = vi.fn()

      emitter.onAny(wildcardHandler)
      emitter.emit('message', { text: 'hello' })
      emitter.emit('count', 42)

      expect(wildcardHandler).toHaveBeenCalledTimes(2)
      expect(wildcardHandler).toHaveBeenNthCalledWith(1, 'message', { text: 'hello' })
      expect(wildcardHandler).toHaveBeenNthCalledWith(2, 'count', 42)
    })

    test('wildcard handler can be removed', () => {
      const emitter = new EventEmitter<TestEvents>()
      const wildcardHandler = vi.fn()

      emitter.onAny(wildcardHandler)
      emitter.emit('message', { text: 'first' })
      emitter.offAny(wildcardHandler)
      emitter.emit('message', { text: 'second' })

      expect(wildcardHandler).toHaveBeenCalledTimes(1)
    })

    test('wildcard subscription unsubscribe works', () => {
      const emitter = new EventEmitter<TestEvents>()
      const wildcardHandler = vi.fn()

      const subscription = emitter.onAny(wildcardHandler)
      emitter.emit('message', { text: 'first' })
      subscription.unsubscribe()
      emitter.emit('message', { text: 'second' })

      expect(wildcardHandler).toHaveBeenCalledTimes(1)
    })

    test('wildcard and specific handlers both fire', () => {
      const emitter = new EventEmitter<TestEvents>()
      const wildcardHandler = vi.fn()
      const specificHandler = vi.fn()

      emitter.onAny(wildcardHandler)
      emitter.on('message', specificHandler)
      emitter.emit('message', { text: 'hello' })

      expect(wildcardHandler).toHaveBeenCalledWith('message', { text: 'hello' })
      expect(specificHandler).toHaveBeenCalledWith({ text: 'hello' })
    })
  })
})

describe('BufferedEmitter', () => {
  test('buffers events while paused', () => {
    const emitter = new BufferedEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.pause()
    emitter.emit('message', { text: 'first' })
    emitter.emit('message', { text: 'second' })

    expect(handler).not.toHaveBeenCalled()
  })

  test('flushes buffered events on resume', () => {
    const emitter = new BufferedEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.pause()
    emitter.emit('message', { text: 'first' })
    emitter.emit('message', { text: 'second' })
    emitter.resume()

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, { text: 'first' })
    expect(handler).toHaveBeenNthCalledWith(2, { text: 'second' })
  })

  test('emits normally when not paused', () => {
    const emitter = new BufferedEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.emit('message', { text: 'hello' })

    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
  })

  test('clear() removes buffered events without emitting', () => {
    const emitter = new BufferedEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.pause()
    emitter.emit('message', { text: 'first' })
    emitter.emit('message', { text: 'second' })
    emitter.clear()
    emitter.resume()

    expect(handler).not.toHaveBeenCalled()
  })

  test('bufferSize returns number of buffered events', () => {
    const emitter = new BufferedEmitter<TestEvents>()

    emitter.pause()
    expect(emitter.bufferSize).toBe(0)

    emitter.emit('message', { text: 'first' })
    emitter.emit('count', 42)
    expect(emitter.bufferSize).toBe(2)
  })

  test('isPaused returns current pause state', () => {
    const emitter = new BufferedEmitter<TestEvents>()

    expect(emitter.isPaused).toBe(false)
    emitter.pause()
    expect(emitter.isPaused).toBe(true)
    emitter.resume()
    expect(emitter.isPaused).toBe(false)
  })
})

describe('FilteredEmitter', () => {
  test('handler with filter option only fires when filter returns true', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.on('count', handler, {
      filter: (payload) => (payload as number) > 10,
    })

    emitter.emit('count', 5)
    emitter.emit('count', 15)
    emitter.emit('count', 8)
    emitter.emit('count', 20)

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, 15)
    expect(handler).toHaveBeenNthCalledWith(2, 20)
  })

  test('FilteredEmitter applies global filter', () => {
    const emitter = new FilteredEmitter<TestEvents>(
      (event, payload) => event !== 'count' || (payload as number) > 10
    )
    const countHandler = vi.fn()
    const messageHandler = vi.fn()

    emitter.on('count', countHandler)
    emitter.on('message', messageHandler)

    emitter.emit('count', 5)
    emitter.emit('count', 15)
    emitter.emit('message', { text: 'hello' })

    expect(countHandler).toHaveBeenCalledTimes(1)
    expect(countHandler).toHaveBeenCalledWith(15)
    expect(messageHandler).toHaveBeenCalledTimes(1)
  })

  test('FilteredEmitter can update filter', () => {
    const emitter = new FilteredEmitter<TestEvents>(() => false)
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.emit('message', { text: 'first' })
    expect(handler).not.toHaveBeenCalled()

    emitter.setFilter(() => true)
    emitter.emit('message', { text: 'second' })
    expect(handler).toHaveBeenCalledWith({ text: 'second' })
  })

  test('FilteredEmitter clearFilter allows all events', () => {
    const emitter = new FilteredEmitter<TestEvents>(() => false)
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.clearFilter()
    emitter.emit('message', { text: 'hello' })

    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
  })
})

describe('EventBus', () => {
  test('EventBus is a singleton', () => {
    const bus1 = EventBus.getInstance<TestEvents>()
    const bus2 = EventBus.getInstance<TestEvents>()

    expect(bus1).toBe(bus2)
  })

  test('EventBus can be used globally', () => {
    const bus = EventBus.getInstance<TestEvents>()
    const handler = vi.fn()

    bus.on('message', handler)
    bus.emit('message', { text: 'global event' })

    expect(handler).toHaveBeenCalledWith({ text: 'global event' })

    // Cleanup for other tests
    bus.removeAllListeners()
  })

  test('EventBus.reset() creates new instance', () => {
    const bus1 = EventBus.getInstance<TestEvents>()
    const handler = vi.fn()
    bus1.on('message', handler)

    EventBus.reset()

    const bus2 = EventBus.getInstance<TestEvents>()
    expect(bus1).not.toBe(bus2)

    bus2.emit('message', { text: 'test' })
    expect(handler).not.toHaveBeenCalled()
  })

  test('createEventBus creates isolated instances', () => {
    const bus1 = createEventBus<TestEvents>()
    const bus2 = createEventBus<TestEvents>()

    expect(bus1).not.toBe(bus2)

    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus1.on('message', handler1)
    bus2.on('message', handler2)

    bus1.emit('message', { text: 'from bus1' })

    expect(handler1).toHaveBeenCalledWith({ text: 'from bus1' })
    expect(handler2).not.toHaveBeenCalled()
  })
})

describe('EventHistory', () => {
  test('records emitted events', () => {
    const emitter = new EventHistory<TestEvents>()

    emitter.emit('message', { text: 'first' })
    emitter.emit('count', 42)
    emitter.emit('message', { text: 'second' })

    const history = emitter.getHistory()
    expect(history.length).toBe(3)
    expect(history[0].event).toBe('message')
    expect(history[0].payload).toEqual({ text: 'first' })
    expect(history[1].event).toBe('count')
    expect(history[1].payload).toBe(42)
  })

  test('events have timestamps', () => {
    const emitter = new EventHistory<TestEvents>()

    const before = Date.now()
    emitter.emit('message', { text: 'test' })
    const after = Date.now()

    const history = emitter.getHistory()
    expect(history[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(history[0].timestamp).toBeLessThanOrEqual(after)
  })

  test('getHistory returns copy, not reference', () => {
    const emitter = new EventHistory<TestEvents>()
    emitter.emit('message', { text: 'test' })

    const history1 = emitter.getHistory()
    const history2 = emitter.getHistory()

    expect(history1).not.toBe(history2)
    expect(history1).toEqual(history2)
  })

  test('clearHistory removes all records', () => {
    const emitter = new EventHistory<TestEvents>()
    emitter.emit('message', { text: 'first' })
    emitter.emit('message', { text: 'second' })

    emitter.clearHistory()

    expect(emitter.getHistory().length).toBe(0)
  })

  test('getHistoryForEvent filters by event type', () => {
    const emitter = new EventHistory<TestEvents>()
    emitter.emit('message', { text: 'first' })
    emitter.emit('count', 42)
    emitter.emit('message', { text: 'second' })
    emitter.emit('count', 100)

    const messageHistory = emitter.getHistoryForEvent('message')
    expect(messageHistory.length).toBe(2)
    expect(messageHistory[0].payload).toEqual({ text: 'first' })
    expect(messageHistory[1].payload).toEqual({ text: 'second' })
  })

  test('respects maxHistory limit', () => {
    const emitter = new EventHistory<TestEvents>({ maxHistory: 3 })

    emitter.emit('count', 1)
    emitter.emit('count', 2)
    emitter.emit('count', 3)
    emitter.emit('count', 4)
    emitter.emit('count', 5)

    const history = emitter.getHistory()
    expect(history.length).toBe(3)
    expect(history[0].payload).toBe(3)
    expect(history[1].payload).toBe(4)
    expect(history[2].payload).toBe(5)
  })

  test('still emits events to handlers', () => {
    const emitter = new EventHistory<TestEvents>()
    const handler = vi.fn()

    emitter.on('message', handler)
    emitter.emit('message', { text: 'hello' })

    expect(handler).toHaveBeenCalledWith({ text: 'hello' })
  })
})

describe('error handling', () => {
  test('sync emit continues after handler throws', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler1 = vi.fn(() => {
      throw new Error('handler1 error')
    })
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)

    // By default, errors propagate and stop execution
    expect(() => emitter.emit('message', { text: 'test' })).toThrow('handler1 error')
    expect(handler1).toHaveBeenCalled()
    // handler2 is not called because handler1 threw
    expect(handler2).not.toHaveBeenCalled()
  })

  test('emitSafe continues after handler throws', () => {
    const emitter = new EventEmitter<TestEvents>()
    const errors: Error[] = []
    const handler1 = vi.fn(() => {
      throw new Error('handler1 error')
    })
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)

    emitter.emitSafe('message', { text: 'test' }, (error) => {
      errors.push(error)
    })

    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe('handler1 error')
  })

  test('emitSafe works with no error handler', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler1 = vi.fn(() => {
      throw new Error('handler1 error')
    })
    const handler2 = vi.fn()

    emitter.on('message', handler1)
    emitter.on('message', handler2)

    // Should not throw
    expect(() => emitter.emitSafe('message', { text: 'test' })).not.toThrow()
    expect(handler1).toHaveBeenCalled()
    expect(handler2).toHaveBeenCalled()
  })

  test('off with non-existent handler does not throw', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    expect(() => emitter.off('message', handler)).not.toThrow()
  })

  test('removeAllListeners with no listeners does not throw', () => {
    const emitter = new EventEmitter<TestEvents>()
    expect(() => emitter.removeAllListeners('message')).not.toThrow()
    expect(() => emitter.removeAllListeners()).not.toThrow()
  })
})

describe('memory leak prevention', () => {
  test('once handlers are removed after firing', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.once('message', handler)
    expect(emitter.listenerCount('message')).toBe(1)

    emitter.emit('message', { text: 'test' })
    expect(emitter.listenerCount('message')).toBe(0)
  })

  test('unsubscribe removes handler', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    const subscription = emitter.on('message', handler)
    expect(emitter.listenerCount('message')).toBe(1)

    subscription.unsubscribe()
    expect(emitter.listenerCount('message')).toBe(0)
  })

  test('double unsubscribe is safe', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    const subscription = emitter.on('message', handler)
    subscription.unsubscribe()
    expect(() => subscription.unsubscribe()).not.toThrow()
    expect(emitter.listenerCount('message')).toBe(0)
  })

  test('maxListeners warns when exceeded', () => {
    const emitter = new EventEmitter<TestEvents>()
    emitter.setMaxListeners(2)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    emitter.on('message', () => {})
    emitter.on('message', () => {})
    emitter.on('message', () => {}) // Should trigger warning

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('MaxListenersExceeded')
    )

    warn.mockRestore()
  })

  test('getMaxListeners returns current limit', () => {
    const emitter = new EventEmitter<TestEvents>()

    // Default is no limit (0 means unlimited)
    expect(emitter.getMaxListeners()).toBe(0)

    emitter.setMaxListeners(10)
    expect(emitter.getMaxListeners()).toBe(10)
  })

  test('setMaxListeners(0) disables warning', () => {
    const emitter = new EventEmitter<TestEvents>()
    emitter.setMaxListeners(2)
    emitter.setMaxListeners(0)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    emitter.on('message', () => {})
    emitter.on('message', () => {})
    emitter.on('message', () => {})

    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  test('removeAllListeners clears all handlers for all events', () => {
    const emitter = new EventEmitter<TestEvents>()

    emitter.on('message', () => {})
    emitter.on('message', () => {})
    emitter.on('count', () => {})

    emitter.removeAllListeners()

    expect(emitter.listenerCount('message')).toBe(0)
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('offAny removes wildcard listener', () => {
    const emitter = new EventEmitter<TestEvents>()
    const handler = vi.fn()

    emitter.onAny(handler)
    emitter.emit('message', { text: 'first' })
    expect(handler).toHaveBeenCalledTimes(1)

    emitter.offAny(handler)
    emitter.emit('message', { text: 'second' })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
