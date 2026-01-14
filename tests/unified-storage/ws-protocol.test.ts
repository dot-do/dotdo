/**
 * WSProtocol Tests
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * WSProtocol defines message types and serialization for WebSocket communication
 * in the Unified Storage architecture. It provides:
 * - Message types: create, read, update, delete, batch, subscribe, unsubscribe
 * - Request/response serialization (JSON and binary)
 * - Validation of message structure
 * - Type guards for safe message handling
 *
 * Architecture context (from unified-storage.md):
 * - WebSocket messages are 20:1 cheaper than HTTP requests
 * - Messages follow a request/response pattern with unique IDs
 * - Subscriptions enable real-time updates with efficient fanout
 * - Binary encoding option for bandwidth-sensitive scenarios
 *
 * Issue: do-2tr.4.1
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  WSProtocol,
  type WSMessage,
  type CreateMessage,
  type ReadMessage,
  type UpdateMessage,
  type DeleteMessage,
  type BatchMessage,
  type SubscribeMessage,
  type UnsubscribeMessage,
  type AckResponse,
  type ReadResponse,
  type ErrorResponse,
  type SubscriptionUpdate,
  type MessageType,
} from '../../objects/unified-storage/ws-protocol'

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WSProtocol', () => {
  // ==========================================================================
  // MESSAGE TYPES
  // ==========================================================================

  describe('message types', () => {
    it('should define CreateMessage type', () => {
      // CreateMessage is used to create new things
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice', email: 'alice@example.com' },
      }

      expect(message.type).toBe('create')
      expect(message.id).toBeDefined()
      expect(message.$type).toBe('Customer')
      expect(message.data).toHaveProperty('name')
    })

    it('should define ReadMessage type', () => {
      // ReadMessage requests one or more things by ID
      const message: ReadMessage = {
        type: 'read',
        id: 'msg-002',
        $ids: ['customer-123', 'customer-456'],
      }

      expect(message.type).toBe('read')
      expect(message.$ids).toHaveLength(2)
      expect(message.$ids).toContain('customer-123')
    })

    it('should define UpdateMessage type', () => {
      // UpdateMessage updates an existing thing by ID
      const message: UpdateMessage = {
        type: 'update',
        id: 'msg-003',
        $id: 'customer-123',
        data: { name: 'Alice Updated' },
      }

      expect(message.type).toBe('update')
      expect(message.$id).toBe('customer-123')
      expect(message.data).toHaveProperty('name')
    })

    it('should define DeleteMessage type', () => {
      // DeleteMessage removes a thing by ID
      const message: DeleteMessage = {
        type: 'delete',
        id: 'msg-004',
        $id: 'customer-123',
      }

      expect(message.type).toBe('delete')
      expect(message.$id).toBe('customer-123')
    })

    it('should define BatchMessage type', () => {
      // BatchMessage groups multiple operations for atomic execution
      const message: BatchMessage = {
        type: 'batch',
        id: 'msg-005',
        operations: [
          { type: 'create', id: 'op-1', $type: 'Order', data: { total: 100 } },
          { type: 'update', id: 'op-2', $id: 'customer-123', data: { orderCount: 5 } },
        ],
      }

      expect(message.type).toBe('batch')
      expect(message.operations).toHaveLength(2)
      expect(message.operations[0].type).toBe('create')
      expect(message.operations[1].type).toBe('update')
    })

    it('should define SubscribeMessage type', () => {
      // SubscribeMessage subscribes to real-time updates for a topic
      const message: SubscribeMessage = {
        type: 'subscribe',
        id: 'msg-006',
        topic: 'Customer.*',
        filter: { status: 'active' },
      }

      expect(message.type).toBe('subscribe')
      expect(message.topic).toBe('Customer.*')
      expect(message.filter).toHaveProperty('status')
    })

    it('should define UnsubscribeMessage type', () => {
      // UnsubscribeMessage cancels a subscription
      const message: UnsubscribeMessage = {
        type: 'unsubscribe',
        id: 'msg-007',
        subscriptionId: 'sub-123',
      }

      expect(message.type).toBe('unsubscribe')
      expect(message.subscriptionId).toBe('sub-123')
    })
  })

  // ==========================================================================
  // SERIALIZATION
  // ==========================================================================

  describe('serialization', () => {
    it('should serialize message to JSON string', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice' },
      }

      const serialized = WSProtocol.serialize(message)

      expect(typeof serialized).toBe('string')
      expect(serialized).toContain('"type":"create"')
      expect(serialized).toContain('"id":"msg-001"')
      expect(serialized).toContain('"$type":"Customer"')
    })

    it('should deserialize JSON string to message', () => {
      const json = '{"type":"create","id":"msg-001","$type":"Customer","data":{"name":"Alice"}}'

      const message = WSProtocol.deserialize(json)

      expect(message.type).toBe('create')
      expect(message.id).toBe('msg-001')
      expect((message as CreateMessage).$type).toBe('Customer')
      expect((message as CreateMessage).data).toEqual({ name: 'Alice' })
    })

    it('should handle binary encoding option', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice', largeField: 'x'.repeat(1000) },
      }

      // Binary encoding should produce ArrayBuffer
      const binary = WSProtocol.serialize(message, { binary: true })

      expect(binary).toBeInstanceOf(ArrayBuffer)

      // Should be deserializable back
      const deserialized = WSProtocol.deserialize(binary)
      expect(deserialized.type).toBe('create')
      expect((deserialized as CreateMessage).data.name).toBe('Alice')
    })

    it('should preserve message id through round-trip', () => {
      const originalId = 'unique-msg-id-12345'
      const message: UpdateMessage = {
        type: 'update',
        id: originalId,
        $id: 'customer-123',
        data: { name: 'Updated' },
      }

      // Round-trip through JSON
      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized)

      expect(deserialized.id).toBe(originalId)
    })

    it('should preserve all fields through round-trip', () => {
      const message: BatchMessage = {
        type: 'batch',
        id: 'batch-001',
        operations: [
          { type: 'create', id: 'op-1', $type: 'Order', data: { total: 99.99 } },
          { type: 'delete', id: 'op-2', $id: 'old-order-123' },
        ],
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as BatchMessage

      expect(deserialized.type).toBe('batch')
      expect(deserialized.operations).toHaveLength(2)
      expect(deserialized.operations[0].type).toBe('create')
      expect((deserialized.operations[0] as CreateMessage).data.total).toBe(99.99)
    })

    it('should handle special characters in data', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Note',
        data: {
          content: 'Hello "World" with\nnewlines\tand\ttabs',
          emoji: 'Test unicode',
        },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      expect(deserialized.data.content).toBe('Hello "World" with\nnewlines\tand\ttabs')
    })

    it('should handle nested objects', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'ComplexThing',
        data: {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      expect(deserialized.data.level1.level2.level3.value).toBe('deep')
    })

    it('should handle arrays in data', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Cart',
        data: {
          items: [
            { sku: 'ABC', qty: 2 },
            { sku: 'DEF', qty: 1 },
          ],
          tags: ['urgent', 'gift'],
        },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      expect(deserialized.data.items).toHaveLength(2)
      expect(deserialized.data.tags).toContain('urgent')
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('validation', () => {
    it('should validate CreateMessage has $type', () => {
      const invalidMessage = {
        type: 'create',
        id: 'msg-001',
        // Missing $type
        data: { name: 'Alice' },
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate CreateMessage has data', () => {
      const invalidMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        // Missing data
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate ReadMessage has $ids array', () => {
      const invalidMessage = {
        type: 'read',
        id: 'msg-001',
        // Missing $ids
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate ReadMessage $ids is non-empty array', () => {
      const invalidMessage = {
        type: 'read',
        id: 'msg-001',
        $ids: [], // Empty array
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate UpdateMessage has $id', () => {
      const invalidMessage = {
        type: 'update',
        id: 'msg-001',
        // Missing $id
        data: { name: 'Updated' },
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate UpdateMessage has data', () => {
      const invalidMessage = {
        type: 'update',
        id: 'msg-001',
        $id: 'customer-123',
        // Missing data
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate DeleteMessage has $id', () => {
      const invalidMessage = {
        type: 'delete',
        id: 'msg-001',
        // Missing $id
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate BatchMessage has operations array', () => {
      const invalidMessage = {
        type: 'batch',
        id: 'msg-001',
        // Missing operations
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate each operation in BatchMessage', () => {
      const invalidMessage = {
        type: 'batch',
        id: 'msg-001',
        operations: [
          { type: 'create', id: 'op-1', $type: 'Order', data: {} }, // Valid
          { type: 'update', id: 'op-2', data: {} }, // Invalid: missing $id
        ],
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate SubscribeMessage has topic', () => {
      const invalidMessage = {
        type: 'subscribe',
        id: 'msg-001',
        // Missing topic
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate UnsubscribeMessage has subscriptionId', () => {
      const invalidMessage = {
        type: 'unsubscribe',
        id: 'msg-001',
        // Missing subscriptionId
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should reject unknown message types', () => {
      const invalidMessage = {
        type: 'unknown_type',
        id: 'msg-001',
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should reject malformed JSON', () => {
      const malformedJson = '{"type":"create","id":"msg-001",$type":broken}'

      expect(() => WSProtocol.deserialize(malformedJson)).toThrow()
    })

    it('should reject empty string', () => {
      expect(() => WSProtocol.deserialize('')).toThrow()
    })

    it('should reject null input', () => {
      expect(() => WSProtocol.deserialize(null as unknown as string)).toThrow()
    })

    it('should validate message has id', () => {
      const invalidMessage = {
        type: 'create',
        // Missing id
        $type: 'Customer',
        data: { name: 'Alice' },
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should validate message has type', () => {
      const invalidMessage = {
        // Missing type
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice' },
      }

      expect(() => WSProtocol.validate(invalidMessage as WSMessage)).toThrow()
    })

    it('should reject oversized payloads', () => {
      const largeData = 'x'.repeat(10 * 1024 * 1024) // 10MB

      expect(() => WSProtocol.deserialize(largeData)).toThrow()
    })
  })

  // ==========================================================================
  // RESPONSE TYPES
  // ==========================================================================

  describe('response types', () => {
    it('should define AckResponse for create/update/delete', () => {
      const response: AckResponse = {
        type: 'ack',
        id: 'msg-001',
        result: {
          $id: 'customer-123',
          $version: 1,
        },
      }

      expect(response.type).toBe('ack')
      expect(response.id).toBe('msg-001')
      expect(response.result.$id).toBe('customer-123')
      expect(response.result.$version).toBe(1)
    })

    it('should define AckResponse for delete without result', () => {
      const response: AckResponse = {
        type: 'ack',
        id: 'msg-001',
      }

      expect(response.type).toBe('ack')
      expect(response.result).toBeUndefined()
    })

    it('should define ReadResponse with things map', () => {
      const response: ReadResponse = {
        type: 'read_response',
        id: 'msg-001',
        things: {
          'customer-123': {
            $id: 'customer-123',
            $type: 'Customer',
            $version: 5,
            name: 'Alice',
          },
          'customer-456': {
            $id: 'customer-456',
            $type: 'Customer',
            $version: 3,
            name: 'Bob',
          },
        },
      }

      expect(response.type).toBe('read_response')
      expect(response.things['customer-123']).toBeDefined()
      expect(response.things['customer-123'].name).toBe('Alice')
      expect(response.things['customer-456'].name).toBe('Bob')
    })

    it('should define ReadResponse with null for not found', () => {
      const response: ReadResponse = {
        type: 'read_response',
        id: 'msg-001',
        things: {
          'customer-123': {
            $id: 'customer-123',
            $type: 'Customer',
            $version: 1,
            name: 'Alice',
          },
          'customer-nonexistent': null, // Not found
        },
      }

      expect(response.things['customer-123']).not.toBeNull()
      expect(response.things['customer-nonexistent']).toBeNull()
    })

    it('should define ErrorResponse with code and message', () => {
      const response: ErrorResponse = {
        type: 'error',
        id: 'msg-001',
        code: 'NOT_FOUND',
        message: 'Thing with id customer-999 not found',
      }

      expect(response.type).toBe('error')
      expect(response.code).toBe('NOT_FOUND')
      expect(response.message).toContain('customer-999')
    })

    it('should define ErrorResponse with details', () => {
      const response: ErrorResponse = {
        type: 'error',
        id: 'msg-001',
        code: 'VALIDATION_ERROR',
        message: 'Invalid message format',
        details: {
          field: '$type',
          reason: 'Required field missing',
        },
      }

      expect(response.type).toBe('error')
      expect(response.details).toBeDefined()
      expect(response.details!.field).toBe('$type')
    })

    it('should define SubscriptionUpdate for broadcasts', () => {
      const update: SubscriptionUpdate = {
        type: 'subscription_update',
        subscriptionId: 'sub-123',
        event: 'created',
        thing: {
          $id: 'customer-789',
          $type: 'Customer',
          $version: 1,
          name: 'New Customer',
        },
      }

      expect(update.type).toBe('subscription_update')
      expect(update.subscriptionId).toBe('sub-123')
      expect(update.event).toBe('created')
      expect(update.thing.$id).toBe('customer-789')
    })

    it('should define SubscriptionUpdate with updated event', () => {
      const update: SubscriptionUpdate = {
        type: 'subscription_update',
        subscriptionId: 'sub-123',
        event: 'updated',
        thing: {
          $id: 'customer-123',
          $type: 'Customer',
          $version: 6,
          name: 'Updated Name',
        },
        delta: {
          name: 'Updated Name',
        },
      }

      expect(update.event).toBe('updated')
      expect(update.delta).toBeDefined()
      expect(update.delta!.name).toBe('Updated Name')
    })

    it('should define SubscriptionUpdate with deleted event', () => {
      const update: SubscriptionUpdate = {
        type: 'subscription_update',
        subscriptionId: 'sub-123',
        event: 'deleted',
        thing: {
          $id: 'customer-123',
          $type: 'Customer',
          $version: 7,
        },
      }

      expect(update.event).toBe('deleted')
      expect(update.thing.$id).toBe('customer-123')
    })
  })

  // ==========================================================================
  // TYPE GUARDS
  // ==========================================================================

  describe('type guards', () => {
    it('should identify CreateMessage', () => {
      const message: WSMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Customer',
        data: { name: 'Alice' },
      } as CreateMessage

      expect(WSProtocol.isCreateMessage(message)).toBe(true)
      expect(WSProtocol.isReadMessage(message)).toBe(false)
      expect(WSProtocol.isUpdateMessage(message)).toBe(false)
      expect(WSProtocol.isDeleteMessage(message)).toBe(false)
    })

    it('should identify ReadMessage', () => {
      const message: WSMessage = {
        type: 'read',
        id: 'msg-001',
        $ids: ['customer-123'],
      } as ReadMessage

      expect(WSProtocol.isReadMessage(message)).toBe(true)
      expect(WSProtocol.isCreateMessage(message)).toBe(false)
    })

    it('should identify UpdateMessage', () => {
      const message: WSMessage = {
        type: 'update',
        id: 'msg-001',
        $id: 'customer-123',
        data: { name: 'Updated' },
      } as UpdateMessage

      expect(WSProtocol.isUpdateMessage(message)).toBe(true)
      expect(WSProtocol.isCreateMessage(message)).toBe(false)
    })

    it('should identify DeleteMessage', () => {
      const message: WSMessage = {
        type: 'delete',
        id: 'msg-001',
        $id: 'customer-123',
      } as DeleteMessage

      expect(WSProtocol.isDeleteMessage(message)).toBe(true)
      expect(WSProtocol.isCreateMessage(message)).toBe(false)
    })

    it('should identify BatchMessage', () => {
      const message: WSMessage = {
        type: 'batch',
        id: 'msg-001',
        operations: [],
      } as BatchMessage

      expect(WSProtocol.isBatchMessage(message)).toBe(true)
      expect(WSProtocol.isCreateMessage(message)).toBe(false)
    })

    it('should identify SubscribeMessage', () => {
      const message: WSMessage = {
        type: 'subscribe',
        id: 'msg-001',
        topic: 'Customer.*',
      } as SubscribeMessage

      expect(WSProtocol.isSubscribeMessage(message)).toBe(true)
      expect(WSProtocol.isCreateMessage(message)).toBe(false)
    })

    it('should identify response types', () => {
      const ack: AckResponse = { type: 'ack', id: 'msg-001' }
      const error: ErrorResponse = { type: 'error', id: 'msg-001', code: 'ERR', message: 'Error' }
      const update: SubscriptionUpdate = {
        type: 'subscription_update',
        subscriptionId: 'sub-1',
        event: 'created',
        thing: { $id: 'x', $type: 'X', $version: 1 },
      }

      expect(WSProtocol.isAckResponse(ack)).toBe(true)
      expect(WSProtocol.isErrorResponse(error)).toBe(true)
      expect(WSProtocol.isSubscriptionUpdate(update)).toBe(true)
    })
  })

  // ==========================================================================
  // FACTORY METHODS
  // ==========================================================================

  describe('factory methods', () => {
    it('should create CreateMessage with auto-generated id', () => {
      const message = WSProtocol.createMessage('Customer', { name: 'Alice' })

      expect(message.type).toBe('create')
      expect(message.id).toBeDefined()
      expect(message.id).toMatch(/^msg-/) // Convention: msg- prefix
      expect(message.$type).toBe('Customer')
      expect(message.data).toEqual({ name: 'Alice' })
    })

    it('should create ReadMessage', () => {
      const message = WSProtocol.readMessage(['id-1', 'id-2'])

      expect(message.type).toBe('read')
      expect(message.$ids).toEqual(['id-1', 'id-2'])
    })

    it('should create UpdateMessage', () => {
      const message = WSProtocol.updateMessage('customer-123', { name: 'Updated' })

      expect(message.type).toBe('update')
      expect(message.$id).toBe('customer-123')
      expect(message.data).toEqual({ name: 'Updated' })
    })

    it('should create DeleteMessage', () => {
      const message = WSProtocol.deleteMessage('customer-123')

      expect(message.type).toBe('delete')
      expect(message.$id).toBe('customer-123')
    })

    it('should create BatchMessage', () => {
      const op1 = WSProtocol.createMessage('Order', { total: 100 })
      const op2 = WSProtocol.updateMessage('customer-123', { orderCount: 5 })

      const message = WSProtocol.batchMessage([op1, op2])

      expect(message.type).toBe('batch')
      expect(message.operations).toHaveLength(2)
    })

    it('should create SubscribeMessage', () => {
      const message = WSProtocol.subscribeMessage('Customer.created')

      expect(message.type).toBe('subscribe')
      expect(message.topic).toBe('Customer.created')
    })

    it('should create SubscribeMessage with filter', () => {
      const message = WSProtocol.subscribeMessage('Customer.*', { status: 'active' })

      expect(message.type).toBe('subscribe')
      expect(message.topic).toBe('Customer.*')
      expect(message.filter).toEqual({ status: 'active' })
    })

    it('should create UnsubscribeMessage', () => {
      const message = WSProtocol.unsubscribeMessage('sub-123')

      expect(message.type).toBe('unsubscribe')
      expect(message.subscriptionId).toBe('sub-123')
    })

    it('should create AckResponse', () => {
      const response = WSProtocol.ackResponse('msg-001', { $id: 'customer-123', $version: 1 })

      expect(response.type).toBe('ack')
      expect(response.id).toBe('msg-001')
      expect(response.result.$id).toBe('customer-123')
    })

    it('should create ErrorResponse', () => {
      const response = WSProtocol.errorResponse('msg-001', 'NOT_FOUND', 'Thing not found')

      expect(response.type).toBe('error')
      expect(response.id).toBe('msg-001')
      expect(response.code).toBe('NOT_FOUND')
      expect(response.message).toBe('Thing not found')
    })
  })

  // ==========================================================================
  // MESSAGE ID GENERATION
  // ==========================================================================

  describe('message ID generation', () => {
    it('should generate unique message IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        const message = WSProtocol.createMessage('Test', { index: i })
        ids.add(message.id)
      }

      expect(ids.size).toBe(100) // All unique
    })

    it('should generate message IDs with prefix', () => {
      const message = WSProtocol.createMessage('Test', {})

      expect(message.id).toMatch(/^msg-/)
    })

    it('should allow custom message ID', () => {
      const customId = 'custom-id-12345'
      const message = WSProtocol.createMessage('Test', {}, { id: customId })

      expect(message.id).toBe(customId)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty data object', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'EmptyThing',
        data: {},
      }

      expect(() => WSProtocol.validate(message)).not.toThrow()
    })

    it('should handle data with null values', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Thing',
        data: { name: 'Alice', deletedAt: null },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      expect(deserialized.data.deletedAt).toBeNull()
    })

    it('should handle data with undefined values', () => {
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Thing',
        data: { name: 'Alice', optional: undefined },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      // undefined values are typically stripped in JSON
      expect('optional' in deserialized.data).toBe(false)
    })

    it('should handle data with Date objects', () => {
      const now = new Date()
      const message: CreateMessage = {
        type: 'create',
        id: 'msg-001',
        $type: 'Thing',
        data: { name: 'Alice', createdAt: now },
      }

      const serialized = WSProtocol.serialize(message)
      const deserialized = WSProtocol.deserialize(serialized) as CreateMessage

      // Dates are serialized as ISO strings
      expect(deserialized.data.createdAt).toBe(now.toISOString())
    })

    it('should handle large batch operations', () => {
      const operations = Array.from({ length: 100 }, (_, i) => ({
        type: 'create' as const,
        id: `op-${i}`,
        $type: 'Item',
        data: { index: i },
      }))

      const message: BatchMessage = {
        type: 'batch',
        id: 'batch-001',
        operations,
      }

      expect(() => WSProtocol.validate(message)).not.toThrow()
    })

    it('should reject batch with too many operations', () => {
      const operations = Array.from({ length: 1001 }, (_, i) => ({
        type: 'create' as const,
        id: `op-${i}`,
        $type: 'Item',
        data: { index: i },
      }))

      const message: BatchMessage = {
        type: 'batch',
        id: 'batch-001',
        operations,
      }

      // Should reject batches exceeding max operations limit (e.g., 1000)
      expect(() => WSProtocol.validate(message)).toThrow()
    })

    it('should handle subscribe with wildcard topic', () => {
      const message: SubscribeMessage = {
        type: 'subscribe',
        id: 'msg-001',
        topic: '*',
      }

      expect(() => WSProtocol.validate(message)).not.toThrow()
    })

    it('should handle subscribe with complex topic pattern', () => {
      const message: SubscribeMessage = {
        type: 'subscribe',
        id: 'msg-001',
        topic: 'Customer.*.created',
      }

      expect(() => WSProtocol.validate(message)).not.toThrow()
    })
  })

  // ==========================================================================
  // ERROR CODES
  // ==========================================================================

  describe('error codes', () => {
    it('should define standard error codes', () => {
      expect(WSProtocol.ErrorCodes.NOT_FOUND).toBe('NOT_FOUND')
      expect(WSProtocol.ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
      expect(WSProtocol.ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED')
      expect(WSProtocol.ErrorCodes.FORBIDDEN).toBe('FORBIDDEN')
      expect(WSProtocol.ErrorCodes.CONFLICT).toBe('CONFLICT')
      expect(WSProtocol.ErrorCodes.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
      expect(WSProtocol.ErrorCodes.RATE_LIMITED).toBe('RATE_LIMITED')
      expect(WSProtocol.ErrorCodes.PAYLOAD_TOO_LARGE).toBe('PAYLOAD_TOO_LARGE')
    })
  })
})
