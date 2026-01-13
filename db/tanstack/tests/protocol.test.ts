/**
 * Protocol Wire Format Tests - TanStack DB Sync Protocol
 *
 * Tests for the sync protocol type definitions and message validation.
 * These tests ensure protocol compliance for WebSocket communication between
 * the client (SyncClient) and server (SyncEngine).
 *
 * Protocol Overview:
 *
 * Client -> Server:
 *   - subscribe: Request to receive updates for a collection
 *   - unsubscribe: Stop receiving updates for a collection
 *   - pong: Heartbeat response to server ping
 *
 * Server -> Client:
 *   - initial: Full state snapshot after subscription
 *   - insert: New item added to collection
 *   - update: Existing item modified
 *   - delete: Item removed from collection
 *   - ping: Server heartbeat
 *
 * @module db/tanstack/tests/protocol.test
 */

import { describe, it, expect } from 'vitest'
import type {
  SyncItem,
  ChangeType,
  SubscribeMessage,
  UnsubscribeMessage,
  PongMessage,
  ClientMessage,
  InitialMessage,
  InsertMessage,
  UpdateMessage,
  DeleteMessage,
  ChangeMessage,
  PingMessage,
  ServerMessage,
  Change,
} from '../protocol'

// ============================================================================
// TYPE HELPERS FOR VALIDATION
// ============================================================================

/**
 * Runtime validator for SyncItem base fields
 */
function isValidSyncItem(item: unknown): item is SyncItem {
  if (typeof item !== 'object' || item === null) return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj.$id === 'string' &&
    typeof obj.$type === 'string' &&
    typeof obj.createdAt === 'string' &&
    typeof obj.updatedAt === 'string'
  )
}

/**
 * Runtime validator for SubscribeMessage
 */
function isValidSubscribeMessage(msg: unknown): msg is SubscribeMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'subscribe' &&
    typeof obj.collection === 'string'
  )
}

/**
 * Runtime validator for UnsubscribeMessage
 */
function isValidUnsubscribeMessage(msg: unknown): msg is UnsubscribeMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'unsubscribe' &&
    typeof obj.collection === 'string'
  )
}

/**
 * Runtime validator for PongMessage
 */
function isValidPongMessage(msg: unknown): msg is PongMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'pong' &&
    typeof obj.timestamp === 'number'
  )
}

/**
 * Runtime validator for InitialMessage
 */
function isValidInitialMessage(msg: unknown): msg is InitialMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'initial' &&
    typeof obj.collection === 'string' &&
    (obj.branch === null || typeof obj.branch === 'string') &&
    Array.isArray(obj.data) &&
    typeof obj.txid === 'number'
  )
}

/**
 * Runtime validator for InsertMessage
 */
function isValidInsertMessage(msg: unknown): msg is InsertMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'insert' &&
    typeof obj.collection === 'string' &&
    (obj.branch === null || typeof obj.branch === 'string') &&
    typeof obj.key === 'string' &&
    typeof obj.data === 'object' &&
    typeof obj.txid === 'number'
  )
}

/**
 * Runtime validator for UpdateMessage
 */
function isValidUpdateMessage(msg: unknown): msg is UpdateMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'update' &&
    typeof obj.collection === 'string' &&
    (obj.branch === null || typeof obj.branch === 'string') &&
    typeof obj.key === 'string' &&
    typeof obj.data === 'object' &&
    typeof obj.txid === 'number'
  )
}

/**
 * Runtime validator for DeleteMessage
 */
function isValidDeleteMessage(msg: unknown): msg is DeleteMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'delete' &&
    typeof obj.collection === 'string' &&
    (obj.branch === null || typeof obj.branch === 'string') &&
    typeof obj.key === 'string' &&
    typeof obj.txid === 'number'
  )
}

/**
 * Runtime validator for PingMessage
 */
function isValidPingMessage(msg: unknown): msg is PingMessage {
  if (typeof msg !== 'object' || msg === null) return false
  const obj = msg as Record<string, unknown>
  return (
    obj.type === 'ping' &&
    typeof obj.timestamp === 'number'
  )
}

// ============================================================================
// TESTS: Base Types
// ============================================================================

describe('SyncItem base type', () => {
  it('should validate minimal SyncItem', () => {
    const item: SyncItem = {
      $id: 'item-1',
      $type: 'Task',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }

    expect(isValidSyncItem(item)).toBe(true)
  })

  it('should validate SyncItem with optional fields', () => {
    const item: SyncItem = {
      $id: 'item-1',
      $type: 'Task',
      name: 'My Task',
      data: { status: 'active', priority: 1 },
      branch: 'feature-branch',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T12:30:00.000Z',
    }

    expect(isValidSyncItem(item)).toBe(true)
    expect(item.name).toBe('My Task')
    expect(item.data?.status).toBe('active')
    expect(item.branch).toBe('feature-branch')
  })

  it('should validate SyncItem with null branch', () => {
    const item: SyncItem = {
      $id: 'item-1',
      $type: 'Task',
      branch: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }

    expect(isValidSyncItem(item)).toBe(true)
    expect(item.branch).toBeNull()
  })

  it('should reject invalid SyncItem without required fields', () => {
    expect(isValidSyncItem({ $id: 'item-1' })).toBe(false)
    expect(isValidSyncItem({ $type: 'Task' })).toBe(false)
    expect(isValidSyncItem({})).toBe(false)
    expect(isValidSyncItem(null)).toBe(false)
    expect(isValidSyncItem(undefined)).toBe(false)
  })
})

describe('ChangeType enum', () => {
  it('should include all mutation types', () => {
    const types: ChangeType[] = ['insert', 'update', 'delete']

    expect(types).toContain('insert')
    expect(types).toContain('update')
    expect(types).toContain('delete')
    expect(types).toHaveLength(3)
  })
})

// ============================================================================
// TESTS: Client -> Server Messages
// ============================================================================

describe('Client -> Server messages', () => {
  describe('SubscribeMessage', () => {
    it('should validate minimal subscribe message', () => {
      const msg: SubscribeMessage = {
        type: 'subscribe',
        collection: 'Task',
      }

      expect(isValidSubscribeMessage(msg)).toBe(true)
    })

    it('should validate subscribe with branch', () => {
      const msg: SubscribeMessage = {
        type: 'subscribe',
        collection: 'Task',
        branch: 'feature-branch',
      }

      expect(isValidSubscribeMessage(msg)).toBe(true)
      expect(msg.branch).toBe('feature-branch')
    })

    it('should validate subscribe with null branch', () => {
      const msg: SubscribeMessage = {
        type: 'subscribe',
        collection: 'Task',
        branch: null,
      }

      expect(isValidSubscribeMessage(msg)).toBe(true)
      expect(msg.branch).toBeNull()
    })

    it('should validate subscribe with query options', () => {
      const msg: SubscribeMessage = {
        type: 'subscribe',
        collection: 'Task',
        query: {
          limit: 100,
          offset: 0,
        },
      }

      expect(isValidSubscribeMessage(msg)).toBe(true)
      expect(msg.query?.limit).toBe(100)
      expect(msg.query?.offset).toBe(0)
    })

    it('should reject invalid subscribe messages', () => {
      expect(isValidSubscribeMessage({ type: 'subscribe' })).toBe(false)
      expect(isValidSubscribeMessage({ collection: 'Task' })).toBe(false)
      expect(isValidSubscribeMessage({ type: 'other', collection: 'Task' })).toBe(false)
    })
  })

  describe('UnsubscribeMessage', () => {
    it('should validate unsubscribe message', () => {
      const msg: UnsubscribeMessage = {
        type: 'unsubscribe',
        collection: 'Task',
      }

      expect(isValidUnsubscribeMessage(msg)).toBe(true)
    })

    it('should reject invalid unsubscribe messages', () => {
      expect(isValidUnsubscribeMessage({ type: 'unsubscribe' })).toBe(false)
      expect(isValidUnsubscribeMessage({ collection: 'Task' })).toBe(false)
    })
  })

  describe('PongMessage', () => {
    it('should validate pong message', () => {
      const msg: PongMessage = {
        type: 'pong',
        timestamp: Date.now(),
      }

      expect(isValidPongMessage(msg)).toBe(true)
    })

    it('should reject invalid pong messages', () => {
      expect(isValidPongMessage({ type: 'pong' })).toBe(false)
      expect(isValidPongMessage({ timestamp: Date.now() })).toBe(false)
      expect(isValidPongMessage({ type: 'pong', timestamp: 'not-a-number' })).toBe(false)
    })
  })

  describe('ClientMessage union', () => {
    it('should discriminate client message types', () => {
      const messages: ClientMessage[] = [
        { type: 'subscribe', collection: 'Task' },
        { type: 'unsubscribe', collection: 'Task' },
        { type: 'pong', timestamp: Date.now() },
      ]

      for (const msg of messages) {
        switch (msg.type) {
          case 'subscribe':
            expect(msg.collection).toBeDefined()
            break
          case 'unsubscribe':
            expect(msg.collection).toBeDefined()
            break
          case 'pong':
            expect(msg.timestamp).toBeDefined()
            break
        }
      }
    })
  })
})

// ============================================================================
// TESTS: Server -> Client Messages
// ============================================================================

describe('Server -> Client messages', () => {
  const sampleItem: SyncItem = {
    $id: 'task-1',
    $type: 'Task',
    name: 'Sample Task',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }

  describe('InitialMessage', () => {
    it('should validate initial message with empty data', () => {
      const msg: InitialMessage = {
        type: 'initial',
        collection: 'Task',
        branch: null,
        data: [],
        txid: 0,
      }

      expect(isValidInitialMessage(msg)).toBe(true)
    })

    it('should validate initial message with data', () => {
      const msg: InitialMessage = {
        type: 'initial',
        collection: 'Task',
        branch: null,
        data: [sampleItem, { ...sampleItem, $id: 'task-2' }],
        txid: 42,
      }

      expect(isValidInitialMessage(msg)).toBe(true)
      expect(msg.data).toHaveLength(2)
      expect(msg.txid).toBe(42)
    })

    it('should validate initial message with branch', () => {
      const msg: InitialMessage = {
        type: 'initial',
        collection: 'Task',
        branch: 'feature-x',
        data: [],
        txid: 1,
      }

      expect(isValidInitialMessage(msg)).toBe(true)
      expect(msg.branch).toBe('feature-x')
    })

    it('should support generic type parameter', () => {
      interface CustomTask extends SyncItem {
        priority: number
        status: 'pending' | 'done'
      }

      const msg: InitialMessage<CustomTask> = {
        type: 'initial',
        collection: 'CustomTask',
        branch: null,
        data: [
          {
            $id: 'task-1',
            $type: 'CustomTask',
            priority: 1,
            status: 'pending',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        txid: 1,
      }

      expect(msg.data[0].priority).toBe(1)
      expect(msg.data[0].status).toBe('pending')
    })

    it('should reject invalid initial messages', () => {
      expect(isValidInitialMessage({ type: 'initial' })).toBe(false)
      expect(isValidInitialMessage({ type: 'initial', collection: 'Task' })).toBe(false)
      expect(isValidInitialMessage({ type: 'initial', collection: 'Task', data: [] })).toBe(false)
    })
  })

  describe('InsertMessage', () => {
    it('should validate insert message', () => {
      const msg: InsertMessage = {
        type: 'insert',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        data: sampleItem,
        txid: 1,
      }

      expect(isValidInsertMessage(msg)).toBe(true)
    })

    it('should validate insert with branch', () => {
      const msg: InsertMessage = {
        type: 'insert',
        collection: 'Task',
        branch: 'dev',
        key: 'task-1',
        data: sampleItem,
        txid: 1,
      }

      expect(isValidInsertMessage(msg)).toBe(true)
      expect(msg.branch).toBe('dev')
    })

    it('should reject invalid insert messages', () => {
      expect(isValidInsertMessage({ type: 'insert', collection: 'Task' })).toBe(false)
      expect(isValidInsertMessage({ type: 'insert', collection: 'Task', key: 'k' })).toBe(false)
    })
  })

  describe('UpdateMessage', () => {
    it('should validate update message', () => {
      const msg: UpdateMessage = {
        type: 'update',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        data: { ...sampleItem, name: 'Updated Task' },
        txid: 2,
      }

      expect(isValidUpdateMessage(msg)).toBe(true)
    })

    it('should reject invalid update messages', () => {
      expect(isValidUpdateMessage({ type: 'update', collection: 'Task' })).toBe(false)
    })
  })

  describe('DeleteMessage', () => {
    it('should validate delete message', () => {
      const msg: DeleteMessage = {
        type: 'delete',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        txid: 3,
      }

      expect(isValidDeleteMessage(msg)).toBe(true)
    })

    it('should not have data field', () => {
      const msg: DeleteMessage = {
        type: 'delete',
        collection: 'Task',
        branch: null,
        key: 'task-1',
        txid: 3,
      }

      // DeleteMessage explicitly does not have data field
      expect('data' in msg).toBe(false)
    })

    it('should reject invalid delete messages', () => {
      expect(isValidDeleteMessage({ type: 'delete', collection: 'Task' })).toBe(false)
      expect(isValidDeleteMessage({ type: 'delete', key: 'k' })).toBe(false)
    })
  })

  describe('PingMessage', () => {
    it('should validate ping message', () => {
      const msg: PingMessage = {
        type: 'ping',
        timestamp: Date.now(),
      }

      expect(isValidPingMessage(msg)).toBe(true)
    })

    it('should reject invalid ping messages', () => {
      expect(isValidPingMessage({ type: 'ping' })).toBe(false)
      expect(isValidPingMessage({ timestamp: Date.now() })).toBe(false)
    })
  })

  describe('ChangeMessage union', () => {
    it('should discriminate change message types', () => {
      const changes: ChangeMessage[] = [
        { type: 'insert', collection: 'Task', branch: null, key: 'k1', data: sampleItem, txid: 1 },
        { type: 'update', collection: 'Task', branch: null, key: 'k2', data: sampleItem, txid: 2 },
        { type: 'delete', collection: 'Task', branch: null, key: 'k3', txid: 3 },
      ]

      for (const change of changes) {
        expect(['insert', 'update', 'delete']).toContain(change.type)
        expect(change.collection).toBe('Task')
        expect(change.key).toBeDefined()
        expect(change.txid).toBeDefined()

        if (change.type !== 'delete') {
          expect(change.data).toBeDefined()
        }
      }
    })
  })

  describe('ServerMessage union', () => {
    it('should discriminate all server message types', () => {
      const messages: ServerMessage[] = [
        { type: 'initial', collection: 'Task', branch: null, data: [], txid: 0 },
        { type: 'insert', collection: 'Task', branch: null, key: 'k', data: sampleItem, txid: 1 },
        { type: 'update', collection: 'Task', branch: null, key: 'k', data: sampleItem, txid: 2 },
        { type: 'delete', collection: 'Task', branch: null, key: 'k', txid: 3 },
        { type: 'ping', timestamp: Date.now() },
      ]

      for (const msg of messages) {
        switch (msg.type) {
          case 'initial':
            expect(Array.isArray(msg.data)).toBe(true)
            break
          case 'insert':
          case 'update':
            expect(msg.key).toBeDefined()
            expect(msg.data).toBeDefined()
            break
          case 'delete':
            expect(msg.key).toBeDefined()
            break
          case 'ping':
            expect(msg.timestamp).toBeDefined()
            break
        }
      }
    })
  })
})

// ============================================================================
// TESTS: Protocol Versioning (Backward Compatibility)
// ============================================================================

describe('Protocol backward compatibility', () => {
  describe('deprecated Change type', () => {
    it('should still support deprecated Change interface', () => {
      const change: Change = {
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        branch: null,
        data: {
          $id: 'task-1',
          $type: 'Task',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        txid: 1,
      }

      expect(change.type).toBe('insert')
      expect(change.collection).toBe('Task')
      expect(change.key).toBe('task-1')
    })

    it('should allow optional fields in deprecated Change', () => {
      const change: Change = {
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 1,
      }

      // branch and data are optional
      expect(change.branch).toBeUndefined()
      expect(change.data).toBeUndefined()
    })
  })
})

// ============================================================================
// TESTS: JSON Serialization
// ============================================================================

describe('JSON serialization roundtrip', () => {
  it('should serialize and deserialize subscribe message', () => {
    const original: SubscribeMessage = {
      type: 'subscribe',
      collection: 'Task',
      branch: 'main',
      query: { limit: 50 },
    }

    const serialized = JSON.stringify(original)
    const deserialized = JSON.parse(serialized) as SubscribeMessage

    expect(deserialized.type).toBe('subscribe')
    expect(deserialized.collection).toBe('Task')
    expect(deserialized.branch).toBe('main')
    expect(deserialized.query?.limit).toBe(50)
  })

  it('should serialize and deserialize initial message', () => {
    const original: InitialMessage = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [
        {
          $id: 'task-1',
          $type: 'Task',
          name: 'Test',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      txid: 42,
    }

    const serialized = JSON.stringify(original)
    const deserialized = JSON.parse(serialized) as InitialMessage

    expect(deserialized.type).toBe('initial')
    expect(deserialized.data).toHaveLength(1)
    expect(deserialized.data[0].$id).toBe('task-1')
    expect(deserialized.txid).toBe(42)
  })

  it('should preserve null values in serialization', () => {
    const original: InsertMessage = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: {
        $id: 'task-1',
        $type: 'Task',
        branch: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      txid: 1,
    }

    const serialized = JSON.stringify(original)
    const deserialized = JSON.parse(serialized) as InsertMessage

    expect(deserialized.branch).toBeNull()
    expect(deserialized.data.branch).toBeNull()
  })

  it('should handle nested data structures', () => {
    const original: UpdateMessage = {
      type: 'update',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: {
        $id: 'task-1',
        $type: 'Task',
        data: {
          nested: {
            deep: {
              value: 42,
              array: [1, 2, 3],
            },
          },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      txid: 5,
    }

    const serialized = JSON.stringify(original)
    const deserialized = JSON.parse(serialized) as UpdateMessage

    expect((deserialized.data.data as Record<string, unknown>)?.nested).toBeDefined()
  })
})

// ============================================================================
// TESTS: Transaction ID (txid) Semantics
// ============================================================================

describe('Transaction ID semantics', () => {
  it('should start txid from 0 for initial state', () => {
    const msg: InitialMessage = {
      type: 'initial',
      collection: 'Task',
      branch: null,
      data: [],
      txid: 0,
    }

    expect(msg.txid).toBe(0)
  })

  it('should increment txid for each change', () => {
    const changes: ChangeMessage[] = [
      { type: 'insert', collection: 'Task', branch: null, key: 'k1', data: createSampleItem('k1'), txid: 1 },
      { type: 'update', collection: 'Task', branch: null, key: 'k1', data: createSampleItem('k1'), txid: 2 },
      { type: 'delete', collection: 'Task', branch: null, key: 'k1', txid: 3 },
    ]

    for (let i = 0; i < changes.length; i++) {
      expect(changes[i].txid).toBe(i + 1)
    }
  })

  it('should allow large txid values', () => {
    const msg: InsertMessage = {
      type: 'insert',
      collection: 'Task',
      branch: null,
      key: 'task-1',
      data: createSampleItem('task-1'),
      txid: Number.MAX_SAFE_INTEGER,
    }

    expect(msg.txid).toBe(Number.MAX_SAFE_INTEGER)
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createSampleItem(id: string): SyncItem {
  return {
    $id: id,
    $type: 'Task',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}
