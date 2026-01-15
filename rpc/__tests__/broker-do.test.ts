/**
 * BrokerDO Tests - TDD RED Phase
 *
 * Tests for the BrokerDO base class with WebSocket handling.
 * BrokerDO provides WebSocket-based RPC routing between clients and target DOs.
 *
 * Key responsibilities:
 * 1. Accept WebSocket upgrade at /ws/broker endpoint
 * 2. Parse CallMessage and BatchMessage from clients
 * 3. Route RPC calls to target DOs via resolveTarget()
 * 4. Forward responses back to clients
 * 5. Handle errors gracefully with ErrorMessage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  BatchMessage,
  BatchReturnMessage,
  generateBrokerMessageId,
} from '../broker-protocol'
import { BrokerDO, type BrokerEnv, type BrokerDOState, type RpcTarget } from '../broker-do'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Mock WebSocket for testing
 */
class MockWebSocket {
  sent: string[] = []
  closed = false
  closeCode?: number
  closeReason?: string
  readyState = 1 // WebSocket.OPEN

  send(data: string): void {
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = 3 // WebSocket.CLOSED
  }

  getLastMessage<T>(): T | null {
    if (this.sent.length === 0) return null
    return JSON.parse(this.sent[this.sent.length - 1]) as T
  }

  getAllMessages<T>(): T[] {
    return this.sent.map((s) => JSON.parse(s) as T)
  }
}

/**
 * Mock RpcTarget for testing RPC routing
 */
class MockRpcTarget implements RpcTarget {
  public rpcCalls: Array<{ method: string; args: unknown[]; capability?: string }> = []
  public mockResponses: Map<string, unknown> = new Map()
  public shouldError = false
  public errorMessage = 'Mock error'

  async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
    this.rpcCalls.push({ method, args, capability })

    if (this.shouldError) {
      throw new Error(this.errorMessage)
    }

    const response = this.mockResponses.get(method)
    if (response !== undefined) {
      return response
    }

    return { success: true, method, args }
  }
}

/**
 * Mock DurableObjectState for testing
 */
class MockDurableObjectState implements BrokerDOState {
  private webSockets = new Map<string, WebSocket[]>()

  acceptWebSocket(ws: WebSocket, tags?: string[]): void {
    for (const tag of tags ?? ['default']) {
      const existing = this.webSockets.get(tag) ?? []
      existing.push(ws)
      this.webSockets.set(tag, existing)
    }
  }

  getWebSockets(tag?: string): WebSocket[] {
    if (tag) {
      return this.webSockets.get(tag) ?? []
    }
    const all: WebSocket[] = []
    for (const sockets of this.webSockets.values()) {
      all.push(...sockets)
    }
    return all
  }
}

/**
 * Create a test broker instance
 */
function createTestBroker(): BrokerDO<BrokerEnv> {
  const ctx = new MockDurableObjectState()
  return new BrokerDO(ctx, {})
}

// =============================================================================
// WebSocket Connection Tests
// =============================================================================

describe('BrokerDO: WebSocket Connection', () => {
  it('should accept WebSocket upgrade at /ws/broker', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    // Simulate WebSocket connection acceptance
    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:test-client'])

    const connections = broker.ctx.getWebSockets('client:test-client')
    expect(connections).toHaveLength(1)
  })

  it('should tag connections with client ID', async () => {
    const broker = createTestBroker()
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()

    broker.ctx.acceptWebSocket(ws1 as unknown as WebSocket, ['client:client-1'])
    broker.ctx.acceptWebSocket(ws2 as unknown as WebSocket, ['client:client-2'])

    const client1Sockets = broker.ctx.getWebSockets('client:client-1')
    const client2Sockets = broker.ctx.getWebSockets('client:client-2')

    expect(client1Sockets).toHaveLength(1)
    expect(client2Sockets).toHaveLength(1)
    expect(client1Sockets[0]).toBe(ws1)
    expect(client2Sockets[0]).toBe(ws2)
  })

  it('should handle multiple simultaneous connections', async () => {
    const broker = createTestBroker()
    const sockets: MockWebSocket[] = []

    // Create 10 simultaneous connections
    for (let i = 0; i < 10; i++) {
      const ws = new MockWebSocket()
      sockets.push(ws)
      broker.ctx.acceptWebSocket(ws as unknown as WebSocket, [`client:client-${i}`])
    }

    const allSockets = broker.ctx.getWebSockets()
    expect(allSockets).toHaveLength(10)
  })
})

// =============================================================================
// RPC Routing Tests
// =============================================================================

describe('BrokerDO: RPC Routing', () => {
  it('should parse CallMessage and route to target DO', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.mockResponses.set('getUser', { id: 'u-123', name: 'Alice' })

    broker.addMockTarget('worker-1', targetStub)

    const call: CallMessage = {
      id: generateBrokerMessageId(),
      type: 'call',
      target: 'worker-1',
      method: 'getUser',
      args: [{ userId: 'u-123' }],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Verify the call was routed to the target
    expect(targetStub.rpcCalls).toHaveLength(1)
    expect(targetStub.rpcCalls[0].method).toBe('getUser')
    expect(targetStub.rpcCalls[0].args).toEqual([{ userId: 'u-123' }])

    // Verify response was sent back
    const response = ws.getLastMessage<ReturnMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('return')
    expect(response!.id).toBe(call.id)
    expect(response!.value).toEqual({ id: 'u-123', name: 'Alice' })
  })

  it('should forward response back to client WebSocket', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.mockResponses.set('ping', 'pong')

    broker.addMockTarget('worker-ping', targetStub)

    const call: CallMessage = {
      id: 'call-123',
      type: 'call',
      target: 'worker-ping',
      method: 'ping',
      args: [],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    expect(ws.sent).toHaveLength(1)
    const response = ws.getLastMessage<ReturnMessage>()
    expect(response!.type).toBe('return')
    expect(response!.id).toBe('call-123')
    expect(response!.value).toBe('pong')
  })

  it('should handle routing errors gracefully', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.shouldError = true
    targetStub.errorMessage = 'Database connection failed'

    broker.addMockTarget('worker-error', targetStub)

    const call: CallMessage = {
      id: 'call-error',
      type: 'call',
      target: 'worker-error',
      method: 'failingMethod',
      args: [],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.id).toBe('call-error')
    expect(response!.error).toContain('Database connection failed')
  })

  it('should route batch messages in parallel', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.mockResponses.set('methodA', 'resultA')
    targetStub.mockResponses.set('methodB', 'resultB')
    targetStub.mockResponses.set('methodC', 'resultC')

    broker.addMockTarget('worker-batch', targetStub)

    const batch: BatchMessage = {
      id: 'batch-1',
      type: 'batch',
      calls: [
        { id: 'call-a', type: 'call', target: 'worker-batch', method: 'methodA', args: [] },
        { id: 'call-b', type: 'call', target: 'worker-batch', method: 'methodB', args: [] },
        { id: 'call-c', type: 'call', target: 'worker-batch', method: 'methodC', args: [] },
      ],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(batch))

    // All calls should have been made
    expect(targetStub.rpcCalls).toHaveLength(3)

    // Response should be a BatchReturnMessage
    const response = ws.getLastMessage<BatchReturnMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('batch_return')
    expect(response!.id).toBe('batch-1')
    expect(response!.results).toHaveLength(3)

    // Results should match the call order
    const results = response!.results as ReturnMessage[]
    expect(results[0].id).toBe('call-a')
    expect(results[0].value).toBe('resultA')
    expect(results[1].id).toBe('call-b')
    expect(results[1].value).toBe('resultB')
    expect(results[2].id).toBe('call-c')
    expect(results[2].value).toBe('resultC')
  })

  it('should forward capability token opaquely', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()

    broker.addMockTarget('secure-worker', targetStub)

    const opaqueToken = 'cap_v1_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy'

    const call: CallMessage = {
      id: 'call-cap',
      type: 'call',
      target: 'secure-worker',
      method: 'secureAction',
      args: ['data'],
      capability: opaqueToken,
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Capability should be forwarded without modification
    expect(targetStub.rpcCalls[0].capability).toBe(opaqueToken)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('BrokerDO: Error Handling', () => {
  it('should return ErrorMessage for unknown target', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    // Don't add any mock targets

    const call: CallMessage = {
      id: 'call-unknown',
      type: 'call',
      target: 'nonexistent-worker',
      method: 'anyMethod',
      args: [],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.id).toBe('call-unknown')
    expect(response!.error.toLowerCase()).toContain('target')
    expect(response!.code).toBe('TARGET_NOT_FOUND')
  })

  it('should return ErrorMessage for method not found', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()
    targetStub.shouldError = true
    targetStub.errorMessage = 'Method not found: unknownMethod'

    broker.addMockTarget('worker-method', targetStub)

    const call: CallMessage = {
      id: 'call-method-nf',
      type: 'call',
      target: 'worker-method',
      method: 'unknownMethod',
      args: [],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.error).toContain('Method not found')
  })

  it('should timeout slow workers', async () => {
    // Create broker with short timeout for testing
    const ctx = new MockDurableObjectState()
    const broker = new BrokerDO(ctx, {}, { rpcTimeout: 100 })

    const ws = new MockWebSocket()

    // Create a stub that takes too long to respond
    const slowStub: RpcTarget = {
      async rpcCall(): Promise<unknown> {
        // Simulate a 500ms delay (longer than our 100ms timeout)
        await new Promise((r) => setTimeout(r, 500))
        return { success: true }
      },
    }

    broker.addMockTarget('slow-worker', slowStub)

    const call: CallMessage = {
      id: 'call-timeout',
      type: 'call',
      target: 'slow-worker',
      method: 'slowMethod',
      args: [],
    }

    const startTime = Date.now()
    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))
    const elapsed = Date.now() - startTime

    // Should timeout quickly (around 100ms, not 500ms)
    expect(elapsed).toBeLessThan(200)

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.error.toLowerCase()).toContain('timeout')
    expect(response!.code).toBe('TIMEOUT')
  })

  it('should handle malformed JSON gracefully', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    await broker.webSocketMessage(ws as unknown as WebSocket, 'not valid json {{{')

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.error.toLowerCase()).toContain('parse')
    expect(response!.code).toBe('PARSE_ERROR')
  })

  it('should handle invalid message type gracefully', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    const invalidMsg = {
      id: 'invalid-1',
      type: 'invalid_type',
      data: 'whatever',
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(invalidMsg))

    const response = ws.getLastMessage<ErrorMessage>()
    expect(response).not.toBeNull()
    expect(response!.type).toBe('error')
    expect(response!.error.toLowerCase()).toContain('type')
    expect(response!.code).toBe('INVALID_MESSAGE_TYPE')
  })

  it('should handle batch with mixed success/failure results', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    // Success target
    const successStub = new MockRpcTarget()
    successStub.mockResponses.set('successMethod', 'success!')
    broker.addMockTarget('success-worker', successStub)

    // Failure target
    const failStub = new MockRpcTarget()
    failStub.shouldError = true
    failStub.errorMessage = 'Intentional failure'
    broker.addMockTarget('fail-worker', failStub)

    const batch: BatchMessage = {
      id: 'batch-mixed',
      type: 'batch',
      calls: [
        { id: 'call-ok', type: 'call', target: 'success-worker', method: 'successMethod', args: [] },
        { id: 'call-fail', type: 'call', target: 'fail-worker', method: 'failMethod', args: [] },
        { id: 'call-missing', type: 'call', target: 'nonexistent', method: 'anyMethod', args: [] },
      ],
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(batch))

    const response = ws.getLastMessage<BatchReturnMessage>()
    expect(response!.type).toBe('batch_return')
    expect(response!.results).toHaveLength(3)

    // First result should be success
    expect(response!.results[0].type).toBe('return')
    expect((response!.results[0] as ReturnMessage).value).toBe('success!')

    // Second result should be error
    expect(response!.results[1].type).toBe('error')
    expect((response!.results[1] as ErrorMessage).error).toContain('Intentional failure')

    // Third result should be error (target not found)
    expect(response!.results[2].type).toBe('error')
    expect((response!.results[2] as ErrorMessage).code).toBe('TARGET_NOT_FOUND')
  })
})

// =============================================================================
// WebSocket Lifecycle Tests
// =============================================================================

describe('BrokerDO: WebSocket Lifecycle', () => {
  it('should handle WebSocket close gracefully', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:lifecycle-test'])

    // Simulate close - should not throw
    expect(() => {
      broker.webSocketClose(ws as unknown as WebSocket, 1000, 'Normal closure', true)
    }).not.toThrow()
  })

  it('should handle WebSocket error gracefully', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()

    broker.ctx.acceptWebSocket(ws as unknown as WebSocket, ['client:error-test'])

    // Simulate error - should not throw
    expect(() => {
      broker.webSocketError(ws as unknown as WebSocket, new Error('Connection reset'))
    }).not.toThrow()
  })
})

// =============================================================================
// Hono Router Tests
// =============================================================================

describe('BrokerDO: Hono Routes', () => {
  it('should have /ws/broker route registered', () => {
    const broker = createTestBroker()

    // The broker should have routes accessible
    expect(broker.app).toBeDefined()
  })

  it('should return 426 for non-WebSocket requests to /ws/broker', async () => {
    const broker = createTestBroker()

    const request = new Request('https://test.broker.dotdo.dev/ws/broker', {
      method: 'GET',
    })

    const response = await broker.fetch(request)

    expect(response.status).toBe(426) // Upgrade Required
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('BrokerDO: Integration', () => {
  it('should handle a complete RPC round-trip', async () => {
    const broker = createTestBroker()
    const ws = new MockWebSocket()
    const targetStub = new MockRpcTarget()

    // Configure mock response
    targetStub.mockResponses.set('createUser', {
      id: 'user-new-123',
      name: 'New User',
      createdAt: '2024-01-15T00:00:00Z',
    })

    broker.addMockTarget('user-service', targetStub)

    // Send call
    const call: CallMessage = {
      id: generateBrokerMessageId(),
      type: 'call',
      target: 'user-service',
      method: 'createUser',
      args: [{ name: 'New User', email: 'new@example.com' }],
      capability: 'cap_admin_token',
    }

    await broker.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(call))

    // Verify call was made correctly
    expect(targetStub.rpcCalls).toHaveLength(1)
    expect(targetStub.rpcCalls[0]).toEqual({
      method: 'createUser',
      args: [{ name: 'New User', email: 'new@example.com' }],
      capability: 'cap_admin_token',
    })

    // Verify response
    const response = ws.getLastMessage<ReturnMessage>()
    expect(response!.type).toBe('return')
    expect(response!.value).toEqual({
      id: 'user-new-123',
      name: 'New User',
      createdAt: '2024-01-15T00:00:00Z',
    })
  })

  it('should handle concurrent requests from multiple clients', async () => {
    const broker = createTestBroker()
    const ws1 = new MockWebSocket()
    const ws2 = new MockWebSocket()
    const targetStub = new MockRpcTarget()

    targetStub.mockResponses.set('getData', { data: 'shared' })
    broker.addMockTarget('shared-worker', targetStub)

    const call1: CallMessage = {
      id: 'client1-call',
      type: 'call',
      target: 'shared-worker',
      method: 'getData',
      args: ['from-client-1'],
    }

    const call2: CallMessage = {
      id: 'client2-call',
      type: 'call',
      target: 'shared-worker',
      method: 'getData',
      args: ['from-client-2'],
    }

    // Send both calls concurrently
    await Promise.all([
      broker.webSocketMessage(ws1 as unknown as WebSocket, JSON.stringify(call1)),
      broker.webSocketMessage(ws2 as unknown as WebSocket, JSON.stringify(call2)),
    ])

    // Both clients should receive their respective responses
    const response1 = ws1.getLastMessage<ReturnMessage>()
    const response2 = ws2.getLastMessage<ReturnMessage>()

    expect(response1!.id).toBe('client1-call')
    expect(response2!.id).toBe('client2-call')
    expect(response1!.value).toEqual({ data: 'shared' })
    expect(response2!.value).toEqual({ data: 'shared' })
  })
})
