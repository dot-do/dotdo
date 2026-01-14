/**
 * RED Phase Tests: BenthosMessage
 * @dotdo/benthos - Benthos-compatible stream processing SDK
 *
 * Tests for the core message type used throughout the Benthos SDK.
 */

import { describe, it, expect } from 'vitest'
import { BenthosMessage, createMessage, createBatch, isMessage, isBatch, MessageMetadata } from '../src'

describe('BenthosMessage', () => {
  describe('construction', () => {
    it('should create message from string', () => {
      const msg = createMessage('hello world')
      expect(msg.content).toBe('hello world')
    })

    it('should create message from object', () => {
      const msg = createMessage({ name: 'Alice', age: 30 })
      expect(msg.json()).toEqual({ name: 'Alice', age: 30 })
    })

    it('should create message from Uint8Array', () => {
      const bytes = new TextEncoder().encode('binary data')
      const msg = createMessage(bytes)
      expect(msg.bytes).toBeInstanceOf(Uint8Array)
      expect(msg.content).toBe('binary data')
    })

    it('should accept metadata', () => {
      const msg = createMessage('test', { source: 'api', type: 'request' })
      expect(msg.metadata.get('source')).toBe('api')
      expect(msg.metadata.get('type')).toBe('request')
    })

    it('should set timestamp', () => {
      const before = Date.now()
      const msg = createMessage('test')
      const after = Date.now()
      expect(msg.timestamp).toBeGreaterThanOrEqual(before)
      expect(msg.timestamp).toBeLessThanOrEqual(after)
    })

    it('should accept custom timestamp', () => {
      const ts = 1234567890000
      const msg = new BenthosMessage('test', {}, { timestamp: ts })
      expect(msg.timestamp).toBe(ts)
    })
  })

  describe('json parsing', () => {
    it('should parse JSON content', () => {
      const msg = createMessage('{"key": "value"}')
      expect(msg.json()).toEqual({ key: 'value' })
    })

    it('should cache JSON parsing', () => {
      const msg = createMessage({ data: 'test' })
      const first = msg.json()
      const second = msg.json()
      expect(first).toBe(second) // Same reference
    })

    it('should extract nested paths', () => {
      const msg = createMessage({ user: { profile: { name: 'Bob' } } })
      expect(msg.json('user.profile.name')).toBe('Bob')
    })

    it('should return undefined for invalid JSON', () => {
      const msg = createMessage('not json')
      expect(msg.json()).toBeUndefined()
    })

    it('should return undefined for missing paths', () => {
      const msg = createMessage({ a: 1 })
      expect(msg.json('b.c.d')).toBeUndefined()
    })
  })

  describe('root accessor', () => {
    it('should get root as JSON', () => {
      const msg = createMessage({ foo: 'bar' })
      expect(msg.root).toEqual({ foo: 'bar' })
    })

    it('should set root and update bytes', () => {
      const msg = createMessage({ old: 'value' })
      msg.root = { new: 'value' }
      expect(msg.root).toEqual({ new: 'value' })
      expect(msg.json()).toEqual({ new: 'value' })
    })
  })

  describe('meta accessor', () => {
    it('should get metadata value', () => {
      const msg = createMessage('test', { key: 'value' })
      expect(msg.meta('key')).toBe('value')
    })

    it('should return undefined for missing metadata', () => {
      const msg = createMessage('test')
      expect(msg.meta('missing')).toBeUndefined()
    })
  })

  describe('immutable transformations', () => {
    it('should create new message with different content', () => {
      const original = createMessage('original', { meta: 'preserved' })
      const modified = original.withContent('modified')

      expect(original.content).toBe('original')
      expect(modified.content).toBe('modified')
      expect(modified.metadata.get('meta')).toBe('preserved')
    })

    it('should create new message with additional metadata', () => {
      const original = createMessage('test', { a: '1' })
      const modified = original.withMetadata({ b: '2' })

      expect(original.metadata.has('b')).toBe(false)
      expect(modified.metadata.get('a')).toBe('1')
      expect(modified.metadata.get('b')).toBe('2')
    })

    it('should clone message', () => {
      const original = createMessage({ data: 'test' }, { meta: 'value' })
      const cloned = original.clone()

      expect(cloned).not.toBe(original)
      expect(cloned.json()).toEqual(original.json())
      expect(cloned.metadata.toObject()).toEqual(original.metadata.toObject())
    })
  })

  describe('error handling', () => {
    it('should start without error', () => {
      const msg = createMessage('test')
      expect(msg.hasError()).toBe(false)
      expect(msg.getError()).toBeUndefined()
    })

    it('should attach error', () => {
      const msg = createMessage('test')
      const error = new Error('processing failed')
      const withError = msg.withError(error)

      expect(withError.hasError()).toBe(true)
      expect(withError.getError()).toBe(error)
    })

    it('should clear error', () => {
      const msg = createMessage('test')
      const withError = msg.withError(new Error('fail'))
      const cleared = withError.clearError()

      expect(cleared.hasError()).toBe(false)
    })
  })
})

describe('MessageMetadata', () => {
  it('should store and retrieve values', () => {
    const meta = new MessageMetadata()
    meta.set('key', 'value')
    expect(meta.get('key')).toBe('value')
  })

  it('should check existence', () => {
    const meta = new MessageMetadata({ exists: 'yes' })
    expect(meta.has('exists')).toBe(true)
    expect(meta.has('missing')).toBe(false)
  })

  it('should delete values', () => {
    const meta = new MessageMetadata({ key: 'value' })
    meta.delete('key')
    expect(meta.has('key')).toBe(false)
  })

  it('should iterate entries', () => {
    const meta = new MessageMetadata({ a: '1', b: '2' })
    const entries = Array.from(meta.entries())
    expect(entries).toContainEqual(['a', '1'])
    expect(entries).toContainEqual(['b', '2'])
  })

  it('should convert to object', () => {
    const meta = new MessageMetadata({ x: 'y' })
    expect(meta.toObject()).toEqual({ x: 'y' })
  })

  it('should clone independently', () => {
    const original = new MessageMetadata({ key: 'value' })
    const cloned = original.clone()
    cloned.set('key', 'changed')
    expect(original.get('key')).toBe('value')
  })
})

describe('BenthosBatch', () => {
  it('should create batch from messages', () => {
    const batch = createBatch([
      'message 1',
      { json: 'data' },
      createMessage('message 3')
    ])
    expect(batch.length).toBe(3)
  })

  it('should access messages by index', () => {
    const batch = createBatch(['a', 'b', 'c'])
    expect(batch.get(0).content).toBe('a')
    expect(batch.get(1).content).toBe('b')
    expect(batch.get(2).content).toBe('c')
  })

  it('should throw on out of bounds access', () => {
    const batch = createBatch(['a'])
    expect(() => batch.get(5)).toThrow(RangeError)
    expect(() => batch.get(-1)).toThrow(RangeError)
  })

  it('should be iterable', () => {
    const batch = createBatch(['a', 'b'])
    const contents = [...batch].map(m => m.content)
    expect(contents).toEqual(['a', 'b'])
  })

  it('should map messages', () => {
    const batch = createBatch(['hello', 'world'])
    const mapped = batch.map(m => m.withContent(m.content.toUpperCase()))
    expect([...mapped].map(m => m.content)).toEqual(['HELLO', 'WORLD'])
  })

  it('should filter messages', () => {
    const batch = createBatch(['keep', 'drop', 'keep'])
    const filtered = batch.filter(m => m.content === 'keep')
    expect(filtered.length).toBe(2)
  })

  it('should reduce messages', () => {
    const batch = createBatch([{ n: 1 }, { n: 2 }, { n: 3 }])
    const sum = batch.reduce((acc, m) => acc + (m.json() as { n: number }).n, 0)
    expect(sum).toBe(6)
  })

  it('should have batch metadata', () => {
    const batch = createBatch(['a'], { batchId: '123' })
    expect(batch.metadata.get('batchId')).toBe('123')
  })
})

describe('type guards', () => {
  it('should identify BenthosMessage', () => {
    const msg = createMessage('test')
    expect(isMessage(msg)).toBe(true)
    expect(isMessage('not a message')).toBe(false)
    expect(isMessage(null)).toBe(false)
    expect(isMessage({})).toBe(false)
  })

  it('should identify BenthosBatch', () => {
    const batch = createBatch(['a'])
    expect(isBatch(batch)).toBe(true)
    expect(isBatch([])).toBe(false)
    expect(isBatch(null)).toBe(false)
  })
})
