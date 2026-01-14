/**
 * Memory Backend Tests
 *
 * Tests for the in-memory temporal store implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryTemporalStore, createTemporalStore, SimpleEventEmitter } from '../src/backends/memory'

describe('MemoryTemporalStore', () => {
  let store: MemoryTemporalStore<{ id: string; name: string; value: number }>

  beforeEach(() => {
    store = new MemoryTemporalStore({ maxVersions: 5 })
  })

  describe('put and get', () => {
    it('stores and retrieves values', async () => {
      await store.put('key1', { id: '1', name: 'test', value: 100 })

      const result = await store.get('key1')
      expect(result).toEqual({ id: '1', name: 'test', value: 100 })
    })

    it('returns null for non-existent keys', async () => {
      const result = await store.get('non-existent')
      expect(result).toBeNull()
    })

    it('overwrites values on subsequent puts', async () => {
      await store.put('key1', { id: '1', name: 'original', value: 100 })
      await store.put('key1', { id: '1', name: 'updated', value: 200 })

      const result = await store.get('key1')
      expect(result).toEqual({ id: '1', name: 'updated', value: 200 })
    })
  })

  describe('getAsOf', () => {
    it('returns value at specific timestamp', async () => {
      const t1 = 1000
      const t2 = 2000
      const t3 = 3000

      await store.put('key1', { id: '1', name: 'v1', value: 1 }, t1)
      await store.put('key1', { id: '1', name: 'v2', value: 2 }, t2)
      await store.put('key1', { id: '1', name: 'v3', value: 3 }, t3)

      // Query at different times
      const atT1 = await store.getAsOf('key1', t1)
      expect(atT1).toEqual({ id: '1', name: 'v1', value: 1 })

      const atT2 = await store.getAsOf('key1', t2)
      expect(atT2).toEqual({ id: '1', name: 'v2', value: 2 })

      const atT3 = await store.getAsOf('key1', t3)
      expect(atT3).toEqual({ id: '1', name: 'v3', value: 3 })
    })

    it('returns most recent value before timestamp', async () => {
      const t1 = 1000
      const t3 = 3000

      await store.put('key1', { id: '1', name: 'v1', value: 1 }, t1)
      await store.put('key1', { id: '1', name: 'v3', value: 3 }, t3)

      // Query between t1 and t3
      const at2000 = await store.getAsOf('key1', 2000)
      expect(at2000).toEqual({ id: '1', name: 'v1', value: 1 })
    })

    it('returns null for timestamp before first version', async () => {
      await store.put('key1', { id: '1', name: 'v1', value: 1 }, 1000)

      const result = await store.getAsOf('key1', 500)
      expect(result).toBeNull()
    })

    it('returns null for non-existent keys', async () => {
      const result = await store.getAsOf('non-existent', Date.now())
      expect(result).toBeNull()
    })
  })

  describe('getHistory', () => {
    it('returns all versions of a key', async () => {
      await store.put('key1', { id: '1', name: 'v1', value: 1 }, 1000)
      await store.put('key1', { id: '1', name: 'v2', value: 2 }, 2000)
      await store.put('key1', { id: '1', name: 'v3', value: 3 }, 3000)

      const history = await store.getHistory('key1')
      expect(history.length).toBe(3)
      expect(history[0].value.name).toBe('v1')
      expect(history[1].value.name).toBe('v2')
      expect(history[2].value.name).toBe('v3')
    })

    it('returns empty array for non-existent keys', async () => {
      const history = await store.getHistory('non-existent')
      expect(history).toEqual([])
    })
  })

  describe('version limits', () => {
    it('enforces maxVersions limit', async () => {
      const storeWith3 = new MemoryTemporalStore<{ id: string }>({ maxVersions: 3 })

      for (let i = 1; i <= 5; i++) {
        await storeWith3.put('key1', { id: `v${i}` }, i * 1000)
      }

      const history = await storeWith3.getHistory('key1')
      expect(history.length).toBe(3)
      expect(history[0].value.id).toBe('v3') // Oldest kept
      expect(history[2].value.id).toBe('v5') // Latest
    })
  })

  describe('delete', () => {
    it('removes a key', async () => {
      await store.put('key1', { id: '1', name: 'test', value: 100 })
      expect(await store.get('key1')).not.toBeNull()

      const deleted = await store.delete('key1')
      expect(deleted).toBe(true)
      expect(await store.get('key1')).toBeNull()
    })

    it('returns false for non-existent keys', async () => {
      const deleted = await store.delete('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('range', () => {
    it('iterates over all values', async () => {
      await store.put('key1', { id: '1', name: 'first', value: 1 })
      await store.put('key2', { id: '2', name: 'second', value: 2 })
      await store.put('key3', { id: '3', name: 'third', value: 3 })

      const values: { id: string; name: string; value: number }[] = []
      for await (const value of store.range('', {})) {
        values.push(value)
      }

      expect(values.length).toBe(3)
    })
  })

  describe('clear', () => {
    it('removes all data', async () => {
      await store.put('key1', { id: '1', name: 'first', value: 1 })
      await store.put('key2', { id: '2', name: 'second', value: 2 })

      await store.clear()

      expect(await store.get('key1')).toBeNull()
      expect(await store.get('key2')).toBeNull()
      expect(await store.size()).toBe(0)
    })
  })

  describe('keys and size', () => {
    it('returns all keys', async () => {
      await store.put('key1', { id: '1', name: 'first', value: 1 })
      await store.put('key2', { id: '2', name: 'second', value: 2 })

      const keys = await store.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
    })

    it('returns correct size', async () => {
      expect(await store.size()).toBe(0)

      await store.put('key1', { id: '1', name: 'first', value: 1 })
      expect(await store.size()).toBe(1)

      await store.put('key2', { id: '2', name: 'second', value: 2 })
      expect(await store.size()).toBe(2)

      await store.delete('key1')
      expect(await store.size()).toBe(1)
    })
  })
})

describe('createTemporalStore', () => {
  it('creates a MemoryTemporalStore instance', () => {
    const store = createTemporalStore<{ id: string }>()
    expect(store).toBeInstanceOf(MemoryTemporalStore)
  })

  it('passes options to the store', async () => {
    const store = createTemporalStore<{ id: string }>({ maxVersions: 2 })

    await store.put('key1', { id: 'v1' }, 1000)
    await store.put('key1', { id: 'v2' }, 2000)
    await store.put('key1', { id: 'v3' }, 3000)

    const history = await store.getHistory('key1')
    expect(history.length).toBe(2)
  })
})

describe('SimpleEventEmitter', () => {
  it('emits events to listeners', () => {
    const emitter = new SimpleEventEmitter<{ type: string }>()
    const received: { type: string }[] = []

    emitter.on((event) => {
      received.push(event)
    })

    emitter.emit({ type: 'test1' })
    emitter.emit({ type: 'test2' })

    expect(received).toEqual([{ type: 'test1' }, { type: 'test2' }])
  })

  it('allows multiple listeners', () => {
    const emitter = new SimpleEventEmitter<string>()
    const received1: string[] = []
    const received2: string[] = []

    emitter.on((event) => received1.push(event))
    emitter.on((event) => received2.push(event))

    emitter.emit('test')

    expect(received1).toEqual(['test'])
    expect(received2).toEqual(['test'])
  })

  it('returns unsubscribe function', () => {
    const emitter = new SimpleEventEmitter<string>()
    const received: string[] = []

    const unsubscribe = emitter.on((event) => received.push(event))

    emitter.emit('event1')
    unsubscribe()
    emitter.emit('event2')

    expect(received).toEqual(['event1'])
  })

  it('clears all listeners', () => {
    const emitter = new SimpleEventEmitter<string>()
    const received: string[] = []

    emitter.on((event) => received.push(event))
    emitter.on((event) => received.push(event + '!'))

    emitter.emit('before')
    emitter.clear()
    emitter.emit('after')

    expect(received).toEqual(['before', 'before!'])
  })
})
