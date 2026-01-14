/**
 * RED Phase Tests: BenthosMessage envelope type and factory
 * Issue: dotdo-9mnjd
 *
 * These tests define the expected behavior for the BenthosMessage type.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect } from 'vitest'
import {
  BenthosMessage,
  createMessage,
  createBatch,
  MessageMetadata,
  isMessage,
  isBatch
} from '../message'

describe('BenthosMessage', () => {
  describe('createMessage', () => {
    it('creates a message from string content', () => {
      const msg = createMessage('hello world')

      expect(msg.content).toBe('hello world')
      expect(msg.bytes).toEqual(new TextEncoder().encode('hello world'))
      expect(msg.metadata.toObject()).toEqual({})
    })

    it('creates a message from Uint8Array content', () => {
      const bytes = new Uint8Array([104, 101, 108, 108, 111])
      const msg = createMessage(bytes)

      expect(msg.bytes).toEqual(bytes)
      expect(msg.content).toBe('hello')
    })

    it('creates a message from JSON object', () => {
      const data = { name: 'test', value: 42 }
      const msg = createMessage(data)

      expect(msg.json()).toEqual(data)
      expect(msg.content).toBe(JSON.stringify(data))
    })

    it('creates a message with metadata', () => {
      const msg = createMessage('test', {
        'kafka_key': 'my-key',
        'kafka_topic': 'my-topic',
        'kafka_partition': '0'
      })

      expect(msg.metadata.get('kafka_key')).toBe('my-key')
      expect(msg.metadata.get('kafka_topic')).toBe('my-topic')
      expect(msg.metadata.get('kafka_partition')).toBe('0')
    })

    it('creates a message with timestamp', () => {
      const before = Date.now()
      const msg = createMessage('test')
      const after = Date.now()

      expect(msg.timestamp).toBeGreaterThanOrEqual(before)
      expect(msg.timestamp).toBeLessThanOrEqual(after)
    })

    it('allows explicit timestamp override', () => {
      const ts = 1609459200000 // 2021-01-01
      const msg = createMessage('test', {}, { timestamp: ts })

      expect(msg.timestamp).toBe(ts)
    })
  })

  describe('MessageMetadata', () => {
    it('provides get/set/has/delete methods', () => {
      const msg = createMessage('test')

      msg.metadata.set('key1', 'value1')
      expect(msg.metadata.has('key1')).toBe(true)
      expect(msg.metadata.get('key1')).toBe('value1')

      msg.metadata.delete('key1')
      expect(msg.metadata.has('key1')).toBe(false)
      expect(msg.metadata.get('key1')).toBeUndefined()
    })

    it('provides iteration over entries', () => {
      const msg = createMessage('test', {
        'a': '1',
        'b': '2',
        'c': '3'
      })

      const entries = [...msg.metadata.entries()]
      expect(entries).toHaveLength(3)
      expect(entries).toContainEqual(['a', '1'])
      expect(entries).toContainEqual(['b', '2'])
      expect(entries).toContainEqual(['c', '3'])
    })

    it('supports metadata copying', () => {
      const msg1 = createMessage('test', { 'key': 'value' })
      const msg2 = createMessage('test2', msg1.metadata.toObject())

      expect(msg2.metadata.get('key')).toBe('value')

      // Verify it's a copy, not a reference
      msg1.metadata.set('key', 'changed')
      expect(msg2.metadata.get('key')).toBe('value')
    })
  })

  describe('Message immutability helpers', () => {
    it('withContent creates new message with different content', () => {
      const msg1 = createMessage('original', { 'key': 'value' })
      const msg2 = msg1.withContent('modified')

      expect(msg1.content).toBe('original')
      expect(msg2.content).toBe('modified')
      expect(msg2.metadata.get('key')).toBe('value')
    })

    it('withMetadata creates new message with additional metadata', () => {
      const msg1 = createMessage('test', { 'a': '1' })
      const msg2 = msg1.withMetadata({ 'b': '2' })

      expect(msg1.metadata.has('b')).toBe(false)
      expect(msg2.metadata.get('a')).toBe('1')
      expect(msg2.metadata.get('b')).toBe('2')
    })

    it('clone creates a deep copy', () => {
      const msg1 = createMessage({ nested: { value: 1 } }, { 'key': 'value' })
      const msg2 = msg1.clone()

      expect(msg2.json()).toEqual(msg1.json())
      expect(msg2.metadata.get('key')).toBe('value')

      // Verify independence
      msg1.metadata.set('key', 'changed')
      expect(msg2.metadata.get('key')).toBe('value')
    })
  })

  describe('Message JSON methods', () => {
    it('json() parses content as JSON', () => {
      const msg = createMessage('{"name":"test","value":42}')

      expect(msg.json()).toEqual({ name: 'test', value: 42 })
    })

    it('json() throws on invalid JSON', () => {
      const msg = createMessage('not json')

      expect(() => msg.json()).toThrow()
    })

    it('json() with path extracts nested value', () => {
      const msg = createMessage('{"user":{"profile":{"name":"Alice"}}}')

      expect(msg.json('user.profile.name')).toBe('Alice')
      expect(msg.json('user.profile')).toEqual({ name: 'Alice' })
    })

    it('jsonSafe() returns undefined on invalid JSON', () => {
      const msg = createMessage('not json')

      expect(msg.jsonSafe()).toBeUndefined()
    })
  })

  describe('Message error handling', () => {
    it('tracks error state', () => {
      const msg = createMessage('test')

      expect(msg.hasError()).toBe(false)
      expect(msg.getError()).toBeUndefined()

      const errorMsg = msg.withError(new Error('Processing failed'))

      expect(errorMsg.hasError()).toBe(true)
      expect(errorMsg.getError()?.message).toBe('Processing failed')

      // Original unchanged
      expect(msg.hasError()).toBe(false)
    })

    it('clears error with clearError()', () => {
      const msg = createMessage('test').withError(new Error('fail'))
      const cleared = msg.clearError()

      expect(cleared.hasError()).toBe(false)
    })
  })
})

describe('createBatch', () => {
  it('creates a batch from multiple messages', () => {
    const batch = createBatch([
      createMessage('msg1'),
      createMessage('msg2'),
      createMessage('msg3')
    ])

    expect(batch.length).toBe(3)
    expect(batch.get(0).content).toBe('msg1')
    expect(batch.get(1).content).toBe('msg2')
    expect(batch.get(2).content).toBe('msg3')
  })

  it('creates a batch from raw contents', () => {
    const batch = createBatch(['a', 'b', 'c'])

    expect(batch.length).toBe(3)
    expect(batch.get(0).content).toBe('a')
  })

  it('provides array-like iteration', () => {
    const batch = createBatch(['a', 'b', 'c'])
    const contents = [...batch].map(m => m.content)

    expect(contents).toEqual(['a', 'b', 'c'])
  })

  it('supports map/filter/reduce', () => {
    const batch = createBatch([1, 2, 3, 4, 5].map(n => ({ value: n })))

    const doubled = batch.map(m => m.withContent({ value: m.json().value * 2 }))
    expect(doubled.get(0).json()).toEqual({ value: 2 })

    const evens = batch.filter(m => m.json().value % 2 === 0)
    expect(evens.length).toBe(2)

    const sum = batch.reduce((acc, m) => acc + m.json().value, 0)
    expect(sum).toBe(15)
  })

  it('supports batch metadata', () => {
    const batch = createBatch(['a', 'b'], { 'batch_id': '123' })

    expect(batch.metadata.get('batch_id')).toBe('123')
  })

  it('provides toArray() for conversion', () => {
    const batch = createBatch(['a', 'b', 'c'])
    const arr = batch.toArray()

    expect(Array.isArray(arr)).toBe(true)
    expect(arr).toHaveLength(3)
  })
})

describe('Type guards', () => {
  it('isMessage correctly identifies messages', () => {
    const msg = createMessage('test')
    const batch = createBatch(['test'])

    expect(isMessage(msg)).toBe(true)
    expect(isMessage(batch)).toBe(false)
    expect(isMessage('string')).toBe(false)
    expect(isMessage(null)).toBe(false)
  })

  it('isBatch correctly identifies batches', () => {
    const msg = createMessage('test')
    const batch = createBatch(['test'])

    expect(isBatch(batch)).toBe(true)
    expect(isBatch(msg)).toBe(false)
    expect(isBatch([])).toBe(false)
    expect(isBatch(null)).toBe(false)
  })
})

describe('Benthos compatibility', () => {
  it('supports this.content access pattern', () => {
    const msg = createMessage('test content')

    // In Bloblang, `this.content` accesses raw content
    expect(msg.content).toBe('test content')
  })

  it('supports this.meta("key") access pattern', () => {
    const msg = createMessage('test', { 'my_key': 'my_value' })

    // In Bloblang, `meta("key")` accesses metadata
    expect(msg.meta('my_key')).toBe('my_value')
    expect(msg.meta('missing')).toBeUndefined()
  })

  it('supports root access for JSON', () => {
    const msg = createMessage({ field: 'value' })

    // In Bloblang, `root = this` or `root.field` accesses parsed JSON
    expect(msg.root).toEqual({ field: 'value' })
    expect(msg.root.field).toBe('value')
  })
})
