/**
 * WSProtocol Optimizations Tests
 *
 * TDD REFACTOR PHASE - Tests for protocol performance optimizations
 *
 * Tests cover:
 * - MessagePack/CBOR binary encoding
 * - Compression for large payloads
 * - Message batching
 * - Delta updates for partial state changes
 * - Schema versioning for backward compatibility
 *
 * Issue: do-2tr.4.10
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WSProtocol,
  PROTOCOL_VERSION,
  type WSMessage,
  type CreateMessage,
  type UpdateMessage,
  type BatchedFrame,
  type StateSnapshot,
  type DeltaUpdate,
  type EncodingFormat,
  type BatchConfig,
} from '../../objects/unified-storage/ws-protocol'

// ============================================================================
// BINARY ENCODING TESTS
// ============================================================================

describe('WSProtocol Binary Encoding', () => {
  describe('MessagePack encoding', () => {
    it('should encode message to MessagePack format', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice', email: 'alice@example.com' },
      }

      const encoded = WSProtocol.encodeMessagePack(message)

      expect(encoded).toBeInstanceOf(ArrayBuffer)
      // Check for MessagePack marker
      const view = new Uint8Array(encoded)
      expect(view[0]).toBe(0x01) // MessagePack marker
    })

    it('should decode MessagePack format back to message', () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-002',
        $type: 'Order',
        data: { total: 99.99, items: ['a', 'b', 'c'] },
      }

      const encoded = WSProtocol.encodeMessagePack(original)
      const decoded = WSProtocol.decodeMessagePack(encoded) as CreateMessage

      expect(decoded.type).toBe('create')
      expect(decoded.id).toBe('msg-002')
      expect(decoded.$type).toBe('Order')
      expect(decoded.data.total).toBe(99.99)
      expect(decoded.data.items).toEqual(['a', 'b', 'c'])
    })

    it('should throw on invalid MessagePack header', () => {
      const invalidBuffer = new ArrayBuffer(10)
      const view = new Uint8Array(invalidBuffer)
      view[0] = 0xff // Invalid marker

      expect(() => WSProtocol.decodeMessagePack(invalidBuffer)).toThrow(
        'Invalid MessagePack header'
      )
    })
  })

  describe('CBOR encoding', () => {
    it('should encode message to CBOR format', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Bob' },
      }

      const encoded = WSProtocol.encodeCBOR(message)

      expect(encoded).toBeInstanceOf(ArrayBuffer)
      // Check for CBOR marker
      const view = new Uint8Array(encoded)
      expect(view[0]).toBe(0x02) // CBOR marker
    })

    it('should decode CBOR format back to message', () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-003',
        $type: 'Product',
        data: { sku: 'ABC123', price: 49.99 },
      }

      const encoded = WSProtocol.encodeCBOR(original)
      const decoded = WSProtocol.decodeCBOR(encoded) as CreateMessage

      expect(decoded.type).toBe('create')
      expect(decoded.$type).toBe('Product')
      expect(decoded.data.sku).toBe('ABC123')
      expect(decoded.data.price).toBe(49.99)
    })

    it('should throw on invalid CBOR header', () => {
      const invalidBuffer = new ArrayBuffer(10)
      const view = new Uint8Array(invalidBuffer)
      view[0] = 0xff // Invalid marker

      expect(() => WSProtocol.decodeCBOR(invalidBuffer)).toThrow('Invalid CBOR header')
    })
  })

  describe('serializeOptimized', () => {
    it('should serialize as JSON by default', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { value: 123 },
      }

      const serialized = WSProtocol.serializeOptimized(message)

      expect(typeof serialized).toBe('string')
      expect(JSON.parse(serialized as string)).toEqual(message)
    })

    it('should serialize as MessagePack when encoding specified', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { value: 123 },
      }

      const serialized = WSProtocol.serializeOptimized(message, { encoding: 'msgpack' })

      expect(serialized).toBeInstanceOf(ArrayBuffer)
    })

    it('should serialize as CBOR when encoding specified', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { value: 123 },
      }

      const serialized = WSProtocol.serializeOptimized(message, { encoding: 'cbor' })

      expect(serialized).toBeInstanceOf(ArrayBuffer)
      const view = new Uint8Array(serialized as ArrayBuffer)
      expect(view[0]).toBe(0x02) // CBOR marker
    })

    it('should include protocol version when requested', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: {},
      }

      const serialized = WSProtocol.serializeOptimized(message, { includeVersion: true })
      const parsed = JSON.parse(serialized as string)

      expect(parsed._protocolVersion).toBe(PROTOCOL_VERSION)
    })

    it('should use msgpack for binary: true (legacy option)', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: {},
      }

      const serialized = WSProtocol.serializeOptimized(message, { binary: true })

      expect(serialized).toBeInstanceOf(ArrayBuffer)
      const view = new Uint8Array(serialized as ArrayBuffer)
      expect(view[0]).toBe(0x01) // MessagePack marker
    })
  })

  describe('deserializeOptimized', () => {
    it('should auto-detect and decode MessagePack', () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { name: 'test' },
      }

      const encoded = WSProtocol.encodeMessagePack(original)
      const decoded = WSProtocol.deserializeOptimized(encoded) as CreateMessage

      expect(decoded.type).toBe('create')
      expect(decoded.data.name).toBe('test')
    })

    it('should auto-detect and decode CBOR', () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { name: 'test' },
      }

      const encoded = WSProtocol.encodeCBOR(original)
      const decoded = WSProtocol.deserializeOptimized(encoded) as CreateMessage

      expect(decoded.type).toBe('create')
      expect(decoded.data.name).toBe('test')
    })

    it('should parse JSON strings', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { value: 42 },
      }

      const json = JSON.stringify(message)
      const decoded = WSProtocol.deserializeOptimized(json) as CreateMessage

      expect(decoded.type).toBe('create')
      expect(decoded.data.value).toBe(42)
    })
  })
})

// ============================================================================
// COMPRESSION TESTS
// ============================================================================

describe('WSProtocol Compression', () => {
  it('should compress data with gzip', async () => {
    const data = new TextEncoder().encode('x'.repeat(2000))

    const compressed = await WSProtocol.compress(data.buffer, 'gzip')

    expect(compressed).toBeInstanceOf(ArrayBuffer)
    // Compressed should be smaller for repetitive data
    expect(compressed.byteLength).toBeLessThan(data.length)
  })

  it('should compress data with deflate', async () => {
    const data = new TextEncoder().encode('y'.repeat(2000))

    const compressed = await WSProtocol.compress(data.buffer, 'deflate')

    expect(compressed).toBeInstanceOf(ArrayBuffer)
    expect(compressed.byteLength).toBeLessThan(data.length)
  })

  it('should return data unchanged when algorithm is none', async () => {
    const data = new TextEncoder().encode('test data')

    const result = await WSProtocol.compress(data.buffer, 'none')

    expect(result.byteLength).toBe(data.length)
  })

  it('should decompress gzip data', async () => {
    const original = 'Hello, compressed world! '.repeat(100)
    const data = new TextEncoder().encode(original)

    const compressed = await WSProtocol.compress(data.buffer, 'gzip')
    const decompressed = await WSProtocol.decompress(compressed, 'gzip')

    const decoded = new TextDecoder().decode(decompressed)
    expect(decoded).toBe(original)
  })

  it('should decompress deflate data', async () => {
    const original = 'Test message with deflate '.repeat(50)
    const data = new TextEncoder().encode(original)

    const compressed = await WSProtocol.compress(data.buffer, 'deflate')
    const decompressed = await WSProtocol.decompress(compressed, 'deflate')

    const decoded = new TextDecoder().decode(decompressed)
    expect(decoded).toBe(original)
  })

  describe('serializeCompressed', () => {
    it('should compress large payloads when enabled', async () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'LargeEntity',
        data: { content: 'x'.repeat(5000) },
      }

      const compressed = await WSProtocol.serializeCompressed(message, {
        compress: true,
        compressionThreshold: 1024,
      })

      expect(compressed).toBeInstanceOf(ArrayBuffer)
      const view = new Uint8Array(compressed)
      expect(view[0]).toBe(0x01) // Compressed flag
    })

    it('should not compress small payloads', async () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Small',
        data: { name: 'tiny' },
      }

      const result = await WSProtocol.serializeCompressed(message, {
        compress: true,
        compressionThreshold: 1024,
      })

      const view = new Uint8Array(result)
      expect(view[0]).toBe(0x00) // Not compressed flag
    })

    it('should not compress when compress is false', async () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Test',
        data: { content: 'x'.repeat(5000) },
      }

      const result = await WSProtocol.serializeCompressed(message, {
        compress: false,
      })

      const view = new Uint8Array(result)
      expect(view[0]).toBe(0x00) // Not compressed flag
    })
  })

  describe('deserializeCompressed', () => {
    it('should round-trip compressed message', async () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-large',
        $type: 'BigEntity',
        data: { content: 'test data '.repeat(500) },
      }

      const compressed = await WSProtocol.serializeCompressed(original, {
        compress: true,
        compressionThreshold: 100,
      })

      const decompressed = await WSProtocol.deserializeCompressed(compressed)

      expect(decompressed.type).toBe('create')
      expect((decompressed as CreateMessage).$type).toBe('BigEntity')
      expect((decompressed as CreateMessage).data.content).toBe('test data '.repeat(500))
    })

    it('should handle uncompressed data', async () => {
      const original: CreateMessage = {
        type: 'create',
        id: 'msg-small',
        $type: 'Tiny',
        data: { x: 1 },
      }

      const serialized = await WSProtocol.serializeCompressed(original, {
        compress: false,
      })

      const deserialized = await WSProtocol.deserializeCompressed(serialized)

      expect(deserialized.type).toBe('create')
      expect((deserialized as CreateMessage).data.x).toBe(1)
    })
  })
})

// ============================================================================
// MESSAGE BATCHING TESTS
// ============================================================================

describe('WSProtocol Message Batching', () => {
  it('should create a batched frame', () => {
    const messages: WSMessage[] = [
      WSProtocol.createMessage('Customer', { name: 'Alice' }),
      WSProtocol.createMessage('Customer', { name: 'Bob' }),
      WSProtocol.createMessage('Order', { total: 100 }),
    ]

    const frame = WSProtocol.createBatchedFrame(messages)

    expect(frame._frame).toBe('batch')
    expect(frame._version).toBe(PROTOCOL_VERSION)
    expect(frame.messages).toHaveLength(3)
    expect(frame.ts).toBeDefined()
  })

  it('should reject batch exceeding max size', () => {
    const messages: WSMessage[] = Array.from({ length: 101 }, (_, i) =>
      WSProtocol.createMessage('Item', { index: i })
    )

    expect(() => WSProtocol.createBatchedFrame(messages)).toThrow(
      'Batch size 101 exceeds maximum 100'
    )
  })

  it('should identify batched frames', () => {
    const frame: BatchedFrame = {
      _frame: 'batch',
      _version: 1,
      messages: [],
      ts: Date.now(),
    }

    expect(WSProtocol.isBatchedFrame(frame)).toBe(true)
    expect(WSProtocol.isBatchedFrame({ type: 'create' })).toBe(false)
    expect(WSProtocol.isBatchedFrame(null)).toBe(false)
    expect(WSProtocol.isBatchedFrame('string')).toBe(false)
  })

  it('should extract messages from batched frame', () => {
    const messages: WSMessage[] = [
      WSProtocol.createMessage('A', {}),
      WSProtocol.createMessage('B', {}),
    ]
    const frame = WSProtocol.createBatchedFrame(messages)

    const extracted = WSProtocol.extractMessages(frame)

    expect(extracted).toHaveLength(2)
    expect(extracted[0]).toBe(messages[0])
    expect(extracted[1]).toBe(messages[1])
  })

  it('should wrap single message in array when extracting', () => {
    const message = WSProtocol.createMessage('Single', { value: 1 })

    const extracted = WSProtocol.extractMessages(message)

    expect(extracted).toHaveLength(1)
    expect(extracted[0]).toBe(message)
  })

  it('should get default batch configuration', () => {
    const config = WSProtocol.getDefaultBatchConfig()

    expect(config.enabled).toBe(false)
    expect(config.windowMs).toBe(10)
    expect(config.maxSize).toBe(100)
  })

  it('should serialize and deserialize batched frames', () => {
    const messages: WSMessage[] = [
      WSProtocol.createMessage('Test', { a: 1 }),
      WSProtocol.updateMessage('id-1', { b: 2 }),
    ]
    const frame = WSProtocol.createBatchedFrame(messages)

    const serialized = WSProtocol.serializeOptimized(frame)
    const deserialized = WSProtocol.deserializeOptimized(serialized as string)

    expect(WSProtocol.isBatchedFrame(deserialized)).toBe(true)
    expect((deserialized as BatchedFrame).messages).toHaveLength(2)
  })
})

// ============================================================================
// DELTA UPDATES TESTS
// ============================================================================

describe('WSProtocol Delta Updates', () => {
  let previousState: StateSnapshot
  let currentState: StateSnapshot

  beforeEach(() => {
    previousState = {
      $id: 'entity-123',
      $type: 'Customer',
      $version: 1,
      data: { name: 'Alice', email: 'alice@example.com', status: 'active' },
      timestamp: Date.now() - 1000,
    }

    currentState = {
      $id: 'entity-123',
      $type: 'Customer',
      $version: 2,
      data: { name: 'Alice Smith', email: 'alice@example.com', phone: '123-456' },
      timestamp: Date.now(),
    }
  })

  it('should compute delta between states', () => {
    const delta = WSProtocol.computeDelta(previousState, currentState)

    expect(delta).not.toBeNull()
    expect(delta!.$id).toBe('entity-123')
    expect(delta!.fromVersion).toBe(1)
    expect(delta!.toVersion).toBe(2)
    expect(delta!.delta.name).toBe('Alice Smith') // Changed
    expect(delta!.delta.phone).toBe('123-456') // Added
    expect(delta!.delta.status).toBeUndefined() // Removed (set to undefined)
    expect(delta!.previousValues?.name).toBe('Alice')
    expect(delta!.previousValues?.status).toBe('active')
  })

  it('should return null when no changes', () => {
    const state1: StateSnapshot = {
      $id: 'x',
      $type: 'X',
      $version: 1,
      data: { a: 1, b: 2 },
      timestamp: Date.now(),
    }
    const state2: StateSnapshot = {
      $id: 'x',
      $type: 'X',
      $version: 2,
      data: { a: 1, b: 2 },
      timestamp: Date.now(),
    }

    const delta = WSProtocol.computeDelta(state1, state2)

    expect(delta).toBeNull()
  })

  it('should throw when computing delta for different entities', () => {
    const other: StateSnapshot = { ...currentState, $id: 'other-id' }

    expect(() => WSProtocol.computeDelta(previousState, other)).toThrow(
      'Cannot compute delta between different entities'
    )
  })

  it('should apply delta to state', () => {
    const delta = WSProtocol.computeDelta(previousState, currentState)!

    const newState = WSProtocol.applyDelta(previousState, delta)

    expect(newState.$id).toBe('entity-123')
    expect(newState.$version).toBe(2)
    expect(newState.data.name).toBe('Alice Smith')
    expect(newState.data.phone).toBe('123-456')
    expect(newState.data.status).toBeUndefined()
    expect(newState.data.email).toBe('alice@example.com') // Unchanged
  })

  it('should throw when applying delta to different entity', () => {
    const delta = WSProtocol.computeDelta(previousState, currentState)!
    const other: StateSnapshot = { ...previousState, $id: 'other-id' }

    expect(() => WSProtocol.applyDelta(other, delta)).toThrow(
      'Cannot apply delta to different entity'
    )
  })

  it('should throw on version mismatch', () => {
    const delta = WSProtocol.computeDelta(previousState, currentState)!
    const wrongVersion: StateSnapshot = { ...previousState, $version: 5 }

    expect(() => WSProtocol.applyDelta(wrongVersion, delta)).toThrow('Version mismatch')
  })

  it('should create delta update message', () => {
    const msg = WSProtocol.deltaUpdateMessage(
      'entity-123',
      { name: 'Updated' },
      1,
      { id: 'msg-delta' }
    )

    expect(msg.type).toBe('update')
    expect(msg.$id).toBe('entity-123')
    expect(msg.data).toEqual({ name: 'Updated' })
    expect(msg._delta).toBe(true)
    expect(msg._fromVersion).toBe(1)
  })

  it('should identify delta update messages', () => {
    const deltaMsg = WSProtocol.deltaUpdateMessage('id', { x: 1 }, 1)
    const normalMsg = WSProtocol.updateMessage('id', { x: 1 })

    expect(WSProtocol.isDeltaUpdate(deltaMsg)).toBe(true)
    expect(WSProtocol.isDeltaUpdate(normalMsg)).toBe(false)
  })

  describe('deepEqual', () => {
    it('should compare primitives', () => {
      expect(WSProtocol.deepEqual(1, 1)).toBe(true)
      expect(WSProtocol.deepEqual(1, 2)).toBe(false)
      expect(WSProtocol.deepEqual('a', 'a')).toBe(true)
      expect(WSProtocol.deepEqual('a', 'b')).toBe(false)
      expect(WSProtocol.deepEqual(true, true)).toBe(true)
      expect(WSProtocol.deepEqual(true, false)).toBe(false)
    })

    it('should compare null and undefined', () => {
      expect(WSProtocol.deepEqual(null, null)).toBe(true)
      expect(WSProtocol.deepEqual(undefined, undefined)).toBe(true)
      expect(WSProtocol.deepEqual(null, undefined)).toBe(false)
    })

    it('should compare arrays', () => {
      expect(WSProtocol.deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(WSProtocol.deepEqual([1, 2], [1, 2, 3])).toBe(false)
      expect(WSProtocol.deepEqual([1, 2, 3], [1, 3, 2])).toBe(false)
    })

    it('should compare nested objects', () => {
      const a = { x: { y: { z: 1 } } }
      const b = { x: { y: { z: 1 } } }
      const c = { x: { y: { z: 2 } } }

      expect(WSProtocol.deepEqual(a, b)).toBe(true)
      expect(WSProtocol.deepEqual(a, c)).toBe(false)
    })

    it('should compare mixed nested structures', () => {
      const a = { arr: [1, { x: 2 }], obj: { y: [3, 4] } }
      const b = { arr: [1, { x: 2 }], obj: { y: [3, 4] } }
      const c = { arr: [1, { x: 2 }], obj: { y: [3, 5] } }

      expect(WSProtocol.deepEqual(a, b)).toBe(true)
      expect(WSProtocol.deepEqual(a, c)).toBe(false)
    })
  })
})

// ============================================================================
// SCHEMA VERSIONING TESTS
// ============================================================================

describe('WSProtocol Schema Versioning', () => {
  it('should return current protocol version', () => {
    const version = WSProtocol.getProtocolVersion()

    expect(version).toBe(PROTOCOL_VERSION)
    expect(typeof version).toBe('number')
  })

  it('should detect version in message', () => {
    const withVersion = { type: 'create', _protocolVersion: 1 }
    const withoutVersion = { type: 'create' }

    expect(WSProtocol.hasVersion(withVersion)).toBe(true)
    expect(WSProtocol.hasVersion(withoutVersion)).toBe(false)
    expect(WSProtocol.hasVersion(null)).toBe(false)
  })

  it('should get message version', () => {
    const msg = { type: 'create', _protocolVersion: 2 }

    expect(WSProtocol.getMessageVersion(msg)).toBe(2)
    expect(WSProtocol.getMessageVersion({ type: 'create' })).toBeUndefined()
  })

  it('should add version to message', () => {
    const message: CreateMessage = {
      type: 'create',
      id: 'msg-001',
      $type: 'Test',
      data: {},
    }

    const versioned = WSProtocol.withVersion(message)

    expect(versioned._protocolVersion).toBe(PROTOCOL_VERSION)
    expect(versioned.type).toBe('create')
    expect(versioned.id).toBe('msg-001')
  })

  it('should strip version from message', () => {
    const versioned = {
      type: 'create' as const,
      id: 'msg-001',
      $type: 'Test',
      data: {},
      _protocolVersion: 1,
    }

    const stripped = WSProtocol.stripVersion(versioned)

    expect('_protocolVersion' in stripped).toBe(false)
    expect(stripped.type).toBe('create')
    expect(stripped.id).toBe('msg-001')
  })

  it('should check message compatibility', () => {
    expect(WSProtocol.isCompatible({ _protocolVersion: 1 })).toBe(true)
    expect(WSProtocol.isCompatible({ _protocolVersion: PROTOCOL_VERSION })).toBe(true)
    // Future versions would be incompatible
    expect(WSProtocol.isCompatible({ _protocolVersion: 999 })).toBe(false)
    // Messages without version are compatible (assumed v1)
    expect(WSProtocol.isCompatible({ type: 'create' })).toBe(true)
  })

  it('should migrate messages (no-op for v1)', () => {
    const message: CreateMessage = {
      type: 'create',
      id: 'msg-001',
      $type: 'Test',
      data: { x: 1 },
    }

    const migrated = WSProtocol.migrate(message, 1)

    expect(migrated).toBe(message) // Same object, no migration needed
  })
})

// ============================================================================
// WIRE FORMAT TESTS
// ============================================================================

describe('WSProtocol Wire Format', () => {
  it('should create wire header for JSON uncompressed', () => {
    const header = WSProtocol.createWireHeader('json', false)

    expect(header[0]).toBe(0x00) // JSON encoding
    expect(header[1]).toBe(0x00) // No compression, no version
    expect(header.length).toBe(2)
  })

  it('should create wire header for MessagePack compressed', () => {
    const header = WSProtocol.createWireHeader('msgpack', true)

    expect(header[0]).toBe(0x01) // MessagePack encoding
    expect(header[1]).toBe(0x01) // Compressed
    expect(header.length).toBe(2)
  })

  it('should create wire header with version', () => {
    const header = WSProtocol.createWireHeader('cbor', false, PROTOCOL_VERSION)

    expect(header[0]).toBe(0x02) // CBOR encoding
    expect(header[1]).toBe(0x02) // Version flag set
    expect(header[2]).toBe(PROTOCOL_VERSION)
    expect(header.length).toBe(3)
  })

  it('should create wire header with compression and version', () => {
    const header = WSProtocol.createWireHeader('json', true, 1)

    expect(header[0]).toBe(0x00) // JSON
    expect(header[1]).toBe(0x03) // Both compressed and versioned flags
    expect(header[2]).toBe(1)
  })

  it('should parse wire header', () => {
    const buffer = new Uint8Array([0x01, 0x03, 0x01]).buffer // msgpack, compressed+versioned, v1

    const { header, offset } = WSProtocol.parseWireHeader(buffer)

    expect(header.encoding).toBe('msgpack')
    expect(header.compressed).toBe(true)
    expect(header.version).toBe(1)
    expect(offset).toBe(3)
  })

  it('should parse wire header without version', () => {
    const buffer = new Uint8Array([0x02, 0x01]).buffer // cbor, compressed

    const { header, offset } = WSProtocol.parseWireHeader(buffer)

    expect(header.encoding).toBe('cbor')
    expect(header.compressed).toBe(true)
    expect(header.version).toBeUndefined()
    expect(offset).toBe(2)
  })
})

// ============================================================================
// UTILITY TESTS
// ============================================================================

describe('WSProtocol Utilities', () => {
  it('should estimate message size', () => {
    const small: CreateMessage = {
      type: 'create',
      id: 'x',
      $type: 'T',
      data: { a: 1 },
    }
    const large: CreateMessage = {
      type: 'create',
      id: 'x',
      $type: 'T',
      data: { content: 'x'.repeat(1000) },
    }

    const smallSize = WSProtocol.estimateSize(small)
    const largeSize = WSProtocol.estimateSize(large)

    expect(smallSize).toBeLessThan(100)
    expect(largeSize).toBeGreaterThan(1000)
    expect(largeSize).toBeGreaterThan(smallSize)
  })

  it('should estimate batched frame size', () => {
    const messages: WSMessage[] = Array.from({ length: 10 }, () =>
      WSProtocol.createMessage('Item', { data: 'test' })
    )
    const frame = WSProtocol.createBatchedFrame(messages)

    const size = WSProtocol.estimateSize(frame)

    expect(size).toBeGreaterThan(0)
    expect(typeof size).toBe('number')
  })
})
