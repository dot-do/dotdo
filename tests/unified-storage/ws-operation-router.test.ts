/**
 * WSOperationRouter Tests
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * WSOperationRouter routes WebSocket messages to state manager operations:
 * - Parse incoming messages
 * - Route to appropriate handler (create/read/update/delete)
 * - Generate ACK responses
 * - Handle errors gracefully
 *
 * Architecture context (from unified-storage.md):
 * - WebSocket messages are JSON with operation type and payload
 * - Each operation returns an ACK with request ID for correlation
 * - Errors are returned as ErrorResponse messages (not thrown)
 * - Batch operations support atomic (all-or-nothing) mode
 *
 * Issue: do-2tr.4.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  WSOperationRouter,
  type WSMessage,
  type WSCreateMessage,
  type WSReadMessage,
  type WSUpdateMessage,
  type WSDeleteMessage,
  type WSBatchMessage,
  type WSAckResponse,
  type WSReadResponse,
  type WSErrorResponse,
  type WSBatchResponse,
} from '../../objects/unified-storage/ws-operation-router'

import { InMemoryStateManager, type ThingData } from '../../objects/unified-storage/in-memory-state-manager'

// ============================================================================
// MOCK STATE MANAGER
// ============================================================================

/**
 * Create a mock state manager for testing routing behavior
 */
function createMockStateManager() {
  const create = vi.fn((input: { $type: string; name?: string; data?: Record<string, unknown> }) => ({
    $id: `${input.$type.toLowerCase()}_${crypto.randomUUID()}`,
    $type: input.$type,
    $version: 1,
    name: input.name,
    data: input.data,
  }))

  const get = vi.fn(($id: string) => {
    if ($id === 'nonexistent') return null
    return {
      $id,
      $type: 'Customer',
      $version: 1,
      name: 'Test Customer',
    }
  })

  const update = vi.fn(($id: string, updates: Partial<ThingData>) => {
    if ($id === 'nonexistent') throw new Error(`Thing not found: ${$id}`)
    return {
      $id,
      $type: 'Customer',
      $version: 2,
      ...updates,
    }
  })

  const deleteFn = vi.fn(($id: string) => {
    if ($id === 'nonexistent') return null
    return {
      $id,
      $type: 'Customer',
      $version: 1,
      name: 'Deleted Customer',
    }
  })

  return {
    create,
    get,
    update,
    delete: deleteFn,
    // Mock reset helper
    reset: () => {
      create.mockClear()
      get.mockClear()
      update.mockClear()
      deleteFn.mockClear()
    },
  }
}

type MockStateManager = ReturnType<typeof createMockStateManager>

// ============================================================================
// MOCK WEBSOCKET
// ============================================================================

function createMockWebSocket() {
  const sentMessages: unknown[] = []
  const send = vi.fn((data: string | ArrayBuffer) => {
    if (typeof data === 'string') {
      sentMessages.push(JSON.parse(data))
    } else {
      sentMessages.push(data)
    }
  })

  return {
    send,
    sentMessages,
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    // Helper to get last sent message
    getLastMessage: <T = unknown>(): T => sentMessages[sentMessages.length - 1] as T,
    // Helper to clear messages
    clear: () => {
      sentMessages.length = 0
      send.mockClear()
    },
  }
}

type MockWebSocket = ReturnType<typeof createMockWebSocket>

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WSOperationRouter', () => {
  let router: WSOperationRouter
  let mockStateManager: MockStateManager
  let mockWebSocket: MockWebSocket

  beforeEach(() => {
    mockStateManager = createMockStateManager()
    mockWebSocket = createMockWebSocket()
    router = new WSOperationRouter(mockStateManager as unknown as InMemoryStateManager)
  })

  // ==========================================================================
  // MESSAGE ROUTING
  // ==========================================================================

  describe('message routing', () => {
    it('should route create message to stateManager.create', async () => {
      // Given: A create message
      const message: WSCreateMessage = {
        type: 'create',
        requestId: 'req-001',
        payload: {
          $type: 'Customer',
          name: 'Alice',
          data: { email: 'alice@example.com' },
        },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call stateManager.create with correct payload
      expect(mockStateManager.create).toHaveBeenCalledTimes(1)
      expect(mockStateManager.create).toHaveBeenCalledWith({
        $type: 'Customer',
        name: 'Alice',
        data: { email: 'alice@example.com' },
      })
    })

    it('should route read message to stateManager.get', async () => {
      // Given: A read message
      const message: WSReadMessage = {
        type: 'read',
        requestId: 'req-002',
        $ids: ['customer_123'],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call stateManager.get with the ID
      expect(mockStateManager.get).toHaveBeenCalledTimes(1)
      expect(mockStateManager.get).toHaveBeenCalledWith('customer_123')
    })

    it('should route update message to stateManager.update', async () => {
      // Given: An update message
      const message: WSUpdateMessage = {
        type: 'update',
        requestId: 'req-003',
        $id: 'customer_123',
        payload: {
          name: 'Alice Updated',
        },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call stateManager.update with ID and payload
      expect(mockStateManager.update).toHaveBeenCalledTimes(1)
      expect(mockStateManager.update).toHaveBeenCalledWith('customer_123', {
        name: 'Alice Updated',
      })
    })

    it('should route delete message to stateManager.delete', async () => {
      // Given: A delete message
      const message: WSDeleteMessage = {
        type: 'delete',
        requestId: 'req-004',
        $id: 'customer_123',
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call stateManager.delete with the ID
      expect(mockStateManager.delete).toHaveBeenCalledTimes(1)
      expect(mockStateManager.delete).toHaveBeenCalledWith('customer_123')
    })

    it('should route batch message to batch handler', async () => {
      // Given: A batch message with multiple operations
      const message: WSBatchMessage = {
        type: 'batch',
        requestId: 'req-005',
        operations: [
          {
            type: 'create',
            payload: { $type: 'Customer', name: 'Alice' },
          },
          {
            type: 'create',
            payload: { $type: 'Customer', name: 'Bob' },
          },
          {
            type: 'update',
            $id: 'customer_existing',
            payload: { name: 'Updated Name' },
          },
        ],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call appropriate methods for each operation
      expect(mockStateManager.create).toHaveBeenCalledTimes(2)
      expect(mockStateManager.update).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // ACK GENERATION
  // ==========================================================================

  describe('ACK generation', () => {
    it('should send ACK with $id after create', async () => {
      // Given: A create message
      const message: WSCreateMessage = {
        type: 'create',
        requestId: 'req-create-001',
        payload: { $type: 'Customer', name: 'Alice' },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send ACK with the created $id
      const response = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(response.type).toBe('ack')
      expect(response.requestId).toBe('req-create-001')
      expect(response.$id).toBeDefined()
      expect(response.$id).toMatch(/^customer_/)
    })

    it('should send ACK with $version after update', async () => {
      // Given: An update message
      const message: WSUpdateMessage = {
        type: 'update',
        requestId: 'req-update-001',
        $id: 'customer_123',
        payload: { name: 'Alice Updated' },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send ACK with updated $version
      const response = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(response.type).toBe('ack')
      expect(response.requestId).toBe('req-update-001')
      expect(response.$version).toBe(2)
    })

    it('should send ACK after delete', async () => {
      // Given: A delete message
      const message: WSDeleteMessage = {
        type: 'delete',
        requestId: 'req-delete-001',
        $id: 'customer_123',
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send ACK confirming deletion
      const response = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(response.type).toBe('ack')
      expect(response.requestId).toBe('req-delete-001')
      expect(response.success).toBe(true)
    })

    it('should include request id in ACK', async () => {
      // Given: Multiple messages with different request IDs
      const messages: WSMessage[] = [
        { type: 'create', requestId: 'unique-req-1', payload: { $type: 'Item', name: 'One' } },
        { type: 'create', requestId: 'unique-req-2', payload: { $type: 'Item', name: 'Two' } },
        { type: 'create', requestId: 'unique-req-3', payload: { $type: 'Item', name: 'Three' } },
      ]

      // When: Routing all messages
      for (const message of messages) {
        mockWebSocket.clear()
        await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

        // Then: Each ACK should have matching requestId
        const response = mockWebSocket.getLastMessage<WSAckResponse>()
        expect(response.requestId).toBe(message.requestId)
      }
    })

    it('should send ACK immediately (not wait for checkpoint)', async () => {
      // Given: A create message
      const message: WSCreateMessage = {
        type: 'create',
        requestId: 'req-timing-001',
        payload: { $type: 'Customer', name: 'Alice' },
      }

      // When: Routing the message
      const startTime = Date.now()
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)
      const elapsed = Date.now() - startTime

      // Then: ACK should be sent immediately (< 50ms, not waiting for checkpoint)
      // Checkpoint is deferred (every 5s or on hibernate)
      expect(elapsed).toBeLessThan(50)
      expect(mockWebSocket.send).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // READ RESPONSES
  // ==========================================================================

  describe('read responses', () => {
    it('should return things map for read request', async () => {
      // Given: A read message for an existing thing
      const message: WSReadMessage = {
        type: 'read',
        requestId: 'req-read-001',
        $ids: ['customer_123'],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send response with things map
      const response = mockWebSocket.getLastMessage<WSReadResponse>()
      expect(response.type).toBe('read_response')
      expect(response.requestId).toBe('req-read-001')
      expect(response.things).toBeDefined()
      expect(response.things['customer_123']).toBeDefined()
      expect(response.things['customer_123'].$id).toBe('customer_123')
    })

    it('should return null for non-existent things', async () => {
      // Given: A read message for a non-existent thing
      const message: WSReadMessage = {
        type: 'read',
        requestId: 'req-read-002',
        $ids: ['nonexistent'],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send response with null for that ID
      const response = mockWebSocket.getLastMessage<WSReadResponse>()
      expect(response.type).toBe('read_response')
      expect(response.things['nonexistent']).toBeNull()
    })

    it('should support multiple $ids in single read', async () => {
      // Given: A read message with multiple IDs
      const message: WSReadMessage = {
        type: 'read',
        requestId: 'req-read-003',
        $ids: ['customer_1', 'customer_2', 'nonexistent', 'customer_3'],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should call get for each ID and return map
      expect(mockStateManager.get).toHaveBeenCalledTimes(4)
      expect(mockStateManager.get).toHaveBeenCalledWith('customer_1')
      expect(mockStateManager.get).toHaveBeenCalledWith('customer_2')
      expect(mockStateManager.get).toHaveBeenCalledWith('nonexistent')
      expect(mockStateManager.get).toHaveBeenCalledWith('customer_3')

      const response = mockWebSocket.getLastMessage<WSReadResponse>()
      expect(Object.keys(response.things)).toHaveLength(4)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    it('should send ErrorResponse for validation errors', async () => {
      // Given: An invalid message (missing required fields)
      const message = {
        type: 'create',
        requestId: 'req-invalid-001',
        // Missing payload
      } as WSCreateMessage

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send ErrorResponse
      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.requestId).toBe('req-invalid-001')
      expect(response.code).toBe('VALIDATION_ERROR')
      expect(response.message).toBeDefined()
    })

    it('should send ErrorResponse for not found on update', async () => {
      // Given: An update message for non-existent thing
      const message: WSUpdateMessage = {
        type: 'update',
        requestId: 'req-notfound-001',
        $id: 'nonexistent',
        payload: { name: 'Ghost' },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send ErrorResponse with NOT_FOUND code
      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.requestId).toBe('req-notfound-001')
      expect(response.code).toBe('NOT_FOUND')
      expect(response.message).toContain('nonexistent')
    })

    it('should include error code and message', async () => {
      // Given: A message that will cause an error
      const message: WSCreateMessage = {
        type: 'create',
        requestId: 'req-error-001',
        payload: {
          // Missing $type - should cause validation error
          name: 'No Type',
        } as { $type: string; name: string },
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: ErrorResponse should have both code and message
      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.code).toBeDefined()
      expect(typeof response.code).toBe('string')
      expect(response.message).toBeDefined()
      expect(typeof response.message).toBe('string')
    })

    it('should not crash on handler errors', async () => {
      // Given: A state manager that throws
      const throwingManager = {
        ...mockStateManager,
        create: vi.fn(() => {
          throw new Error('Database connection failed')
        }),
      }
      const errorRouter = new WSOperationRouter(throwingManager as unknown as InMemoryStateManager)

      const message: WSCreateMessage = {
        type: 'create',
        requestId: 'req-crash-001',
        payload: { $type: 'Customer', name: 'Alice' },
      }

      // When: Routing the message
      // Then: Should not throw - should send error response instead
      await expect(
        errorRouter.handleMessage(message, mockWebSocket as unknown as WebSocket)
      ).resolves.not.toThrow()

      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.code).toBe('INTERNAL_ERROR')
      expect(response.message).toContain('Database connection failed')
    })
  })

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  describe('batch operations', () => {
    it('should process batch of operations', async () => {
      // Given: A batch message with multiple operations
      const message: WSBatchMessage = {
        type: 'batch',
        requestId: 'req-batch-001',
        operations: [
          { type: 'create', payload: { $type: 'Customer', name: 'Alice' } },
          { type: 'create', payload: { $type: 'Customer', name: 'Bob' } },
          { type: 'update', $id: 'customer_existing', payload: { name: 'Charlie Updated' } },
          { type: 'delete', $id: 'customer_old' },
        ],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: All operations should be processed
      expect(mockStateManager.create).toHaveBeenCalledTimes(2)
      expect(mockStateManager.update).toHaveBeenCalledTimes(1)
      expect(mockStateManager.delete).toHaveBeenCalledTimes(1)
    })

    it('should return results for each operation', async () => {
      // Given: A batch message
      const message: WSBatchMessage = {
        type: 'batch',
        requestId: 'req-batch-002',
        operations: [
          { type: 'create', payload: { $type: 'Customer', name: 'Alice' } },
          { type: 'create', payload: { $type: 'Customer', name: 'Bob' } },
        ],
      }

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Response should include results for each operation
      const response = mockWebSocket.getLastMessage<WSBatchResponse>()
      expect(response.type).toBe('batch_response')
      expect(response.requestId).toBe('req-batch-002')
      expect(response.results).toHaveLength(2)
      expect(response.results[0].success).toBe(true)
      expect(response.results[0].$id).toBeDefined()
      expect(response.results[1].success).toBe(true)
      expect(response.results[1].$id).toBeDefined()
    })

    it('should support atomic batch (all or nothing)', async () => {
      // Given: An atomic batch where one operation will fail
      const failingManager = {
        ...mockStateManager,
        update: vi.fn(($id: string) => {
          if ($id === 'will_fail') throw new Error('Validation failed')
          return { $id, $type: 'Customer', $version: 2 }
        }),
      }
      const atomicRouter = new WSOperationRouter(failingManager as unknown as InMemoryStateManager)

      const message: WSBatchMessage = {
        type: 'batch',
        requestId: 'req-atomic-001',
        atomic: true, // All or nothing
        operations: [
          { type: 'create', payload: { $type: 'Customer', name: 'Alice' } },
          { type: 'update', $id: 'will_fail', payload: { name: 'Fail' } },
          { type: 'create', payload: { $type: 'Customer', name: 'Bob' } },
        ],
      }

      // When: Routing the message
      await atomicRouter.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should indicate batch failure (none committed)
      const response = mockWebSocket.getLastMessage<WSBatchResponse | WSErrorResponse>()
      // Atomic batch should fail entirely
      expect(response.type).toBe('error')
      if (response.type === 'error') {
        expect(response.code).toBe('BATCH_FAILED')
      }
    })

    it('should rollback on atomic batch failure', async () => {
      // Given: An atomic batch router with tracking
      const operations: Array<{ op: string; $id?: string }> = []
      const rollbackCalls: string[] = []

      const trackingManager = {
        create: vi.fn((input: { $type: string; name?: string }) => {
          const $id = `${input.$type.toLowerCase()}_${crypto.randomUUID()}`
          operations.push({ op: 'create', $id })
          return { $id, $type: input.$type, $version: 1, name: input.name }
        }),
        update: vi.fn(($id: string) => {
          if ($id === 'will_fail') {
            throw new Error('Update failed')
          }
          operations.push({ op: 'update', $id })
          return { $id, $type: 'Customer', $version: 2 }
        }),
        delete: vi.fn(($id: string) => {
          // Track rollback deletes
          if (operations.some((o) => o.$id === $id && o.op === 'create')) {
            rollbackCalls.push($id)
          }
          return { $id, $type: 'Customer', $version: 1 }
        }),
        get: vi.fn(),
      }

      const atomicRouter = new WSOperationRouter(trackingManager as unknown as InMemoryStateManager)

      const message: WSBatchMessage = {
        type: 'batch',
        requestId: 'req-rollback-001',
        atomic: true,
        operations: [
          { type: 'create', payload: { $type: 'Customer', name: 'Alice' } },
          { type: 'update', $id: 'will_fail', payload: { name: 'Fail' } },
        ],
      }

      // When: Routing the atomic batch that fails
      await atomicRouter.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should have rolled back the created item
      // The created item should be deleted during rollback
      expect(rollbackCalls).toHaveLength(1)
    })
  })

  // ==========================================================================
  // MESSAGE PARSING
  // ==========================================================================

  describe('message parsing', () => {
    it('should parse JSON string messages', async () => {
      // Given: A JSON string message
      const messageString = JSON.stringify({
        type: 'create',
        requestId: 'req-json-001',
        payload: { $type: 'Customer', name: 'Alice' },
      })

      // When: Routing the string message
      await router.handleMessageString(messageString, mockWebSocket as unknown as WebSocket)

      // Then: Should parse and route correctly
      expect(mockStateManager.create).toHaveBeenCalledWith({
        $type: 'Customer',
        name: 'Alice',
      })
    })

    it('should handle invalid JSON gracefully', async () => {
      // Given: Invalid JSON string
      const invalidJson = 'not valid json {'

      // When: Routing the invalid message
      await router.handleMessageString(invalidJson, mockWebSocket as unknown as WebSocket)

      // Then: Should send parse error response
      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.code).toBe('PARSE_ERROR')
    })

    it('should handle unknown message types', async () => {
      // Given: A message with unknown type
      const message = {
        type: 'unknown_type',
        requestId: 'req-unknown-001',
      } as WSMessage

      // When: Routing the message
      await router.handleMessage(message, mockWebSocket as unknown as WebSocket)

      // Then: Should send error for unknown type
      const response = mockWebSocket.getLastMessage<WSErrorResponse>()
      expect(response.type).toBe('error')
      expect(response.code).toBe('UNKNOWN_TYPE')
    })
  })

  // ==========================================================================
  // INTEGRATION WITH REAL STATE MANAGER
  // ==========================================================================

  describe('integration with InMemoryStateManager', () => {
    let realStateManager: InMemoryStateManager
    let integrationRouter: WSOperationRouter

    beforeEach(() => {
      realStateManager = new InMemoryStateManager()
      integrationRouter = new WSOperationRouter(realStateManager)
    })

    it('should create and read things end-to-end', async () => {
      // Given: A create message
      const createMessage: WSCreateMessage = {
        type: 'create',
        requestId: 'req-e2e-001',
        payload: { $type: 'Customer', name: 'Alice', data: { tier: 'premium' } },
      }

      // When: Creating via router
      await integrationRouter.handleMessage(createMessage, mockWebSocket as unknown as WebSocket)

      // Then: Should receive ACK with $id
      const ackResponse = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(ackResponse.$id).toBeDefined()
      const createdId = ackResponse.$id!

      // And: Should be able to read the created thing
      mockWebSocket.clear()
      const readMessage: WSReadMessage = {
        type: 'read',
        requestId: 'req-e2e-002',
        $ids: [createdId],
      }

      await integrationRouter.handleMessage(readMessage, mockWebSocket as unknown as WebSocket)

      const readResponse = mockWebSocket.getLastMessage<WSReadResponse>()
      expect(readResponse.things[createdId]).toBeDefined()
      expect(readResponse.things[createdId]!.name).toBe('Alice')
      expect(readResponse.things[createdId]!.data?.tier).toBe('premium')
    })

    it('should update things end-to-end', async () => {
      // Given: An existing thing
      const created = realStateManager.create({
        $type: 'Customer',
        name: 'Bob',
      })

      // When: Updating via router
      const updateMessage: WSUpdateMessage = {
        type: 'update',
        requestId: 'req-e2e-003',
        $id: created.$id,
        payload: { name: 'Bob Updated' },
      }

      await integrationRouter.handleMessage(updateMessage, mockWebSocket as unknown as WebSocket)

      // Then: Should receive ACK with new version
      const ackResponse = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(ackResponse.$version).toBe(2)

      // And: Reading should show updated value
      const retrieved = realStateManager.get(created.$id)
      expect(retrieved?.name).toBe('Bob Updated')
    })

    it('should delete things end-to-end', async () => {
      // Given: An existing thing
      const created = realStateManager.create({
        $type: 'Customer',
        name: 'Charlie',
      })

      // When: Deleting via router
      const deleteMessage: WSDeleteMessage = {
        type: 'delete',
        requestId: 'req-e2e-004',
        $id: created.$id,
      }

      await integrationRouter.handleMessage(deleteMessage, mockWebSocket as unknown as WebSocket)

      // Then: Should receive success ACK
      const ackResponse = mockWebSocket.getLastMessage<WSAckResponse>()
      expect(ackResponse.success).toBe(true)

      // And: Thing should no longer exist
      const retrieved = realStateManager.get(created.$id)
      expect(retrieved).toBeNull()
    })
  })
})
