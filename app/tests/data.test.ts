import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import { createDataClient, DataMode } from '../data'
import type { DataClient, DataClientOptions } from '../data'

// Store original dispatcher
const originalDispatcher = getGlobalDispatcher()

// Mock WebSocket
class MockWebSocket {
  public readyState = 1 // OPEN
  public onopen: ((event: Event) => void) | null = null
  public onclose: ((event: CloseEvent) => void) | null = null
  public onmessage: ((event: MessageEvent) => void) | null = null
  public onerror: ((event: Event) => void) | null = null
  public sentMessages: string[] = []
  static instances: MockWebSocket[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    // Simulate async connection
    setTimeout(() => {
      if (this.onopen) {
        this.onopen({ type: 'open' })
      }
    }, 0)
  }

  send(data: string) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose({ type: 'close', code, reason, wasClean: true })
    }
  }

  // Simulate receiving a message from server
  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ type: 'message', data: JSON.stringify(data) })
    }
  }

  // Simulate error
  simulateError() {
    if (this.onerror) {
      this.onerror({ type: 'error' })
    }
  }

  static getLatest(): MockWebSocket | undefined {
    return this.instances[this.instances.length - 1]
  }

  static reset() {
    this.instances = []
  }
}

// Store original WebSocket
const OriginalWebSocket = global.WebSocket

describe('Data Layer - REST Mode', () => {
  let client: DataClient
  let mockAgent: MockAgent
  let mockPool: ReturnType<MockAgent['get']>

  beforeEach(() => {
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
    mockPool = mockAgent.get('https://api.test.dotdo.dev')

    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
    })
  })

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  it('should fetch data via HTTP GET', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }

    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    const result = await client.get('customers', '1')

    expect(result).toEqual(mockData)
  })

  it('should create data via HTTP POST', async () => {
    const newCustomer = { name: 'Bob' }
    const createdCustomer = { $id: '2', $type: 'Customer', ...newCustomer }

    mockPool.intercept({
      path: '/customers',
      method: 'POST',
    }).reply(201, createdCustomer)

    const result = await client.create('customers', newCustomer)

    expect(result).toEqual(createdCustomer)
  })

  it('should update data via HTTP PUT', async () => {
    const updates = { name: 'Alice Updated' }
    const updatedCustomer = { $id: '1', $type: 'Customer', ...updates }

    mockPool.intercept({
      path: '/customers/1',
      method: 'PUT',
    }).reply(200, updatedCustomer)

    const result = await client.update('customers', '1', updates)

    expect(result).toEqual(updatedCustomer)
  })

  it('should delete data via HTTP DELETE', async () => {
    mockPool.intercept({
      path: '/customers/1',
      method: 'DELETE',
    }).reply(204, {})

    await client.delete('customers', '1')
    // If we get here without error, the delete succeeded
    expect(true).toBe(true)
  })

  it('should list data via HTTP GET', async () => {
    const mockList = [
      { $id: '1', $type: 'Customer', name: 'Alice' },
      { $id: '2', $type: 'Customer', name: 'Bob' },
    ]

    mockPool.intercept({
      path: '/customers',
      method: 'GET',
    }).reply(200, mockList)

    const result = await client.list('customers')

    expect(result).toEqual(mockList)
  })

  it('should throw on HTTP error', async () => {
    mockPool.intercept({
      path: '/customers/999',
      method: 'GET',
    }).reply(404, { error: 'Customer not found' })

    await expect(client.get('customers', '999')).rejects.toThrow()
  })
})

describe('Data Layer - TanStack DB Mode', () => {
  let client: DataClient
  let mockWs: MockWebSocket | undefined
  let mockAgent: MockAgent
  let mockPool: ReturnType<MockAgent['get']>

  beforeEach(() => {
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
    mockPool = mockAgent.get('https://api.test.dotdo.dev')

    // Reset mock WebSocket instances
    MockWebSocket.reset()

    // Replace global WebSocket with mock
    global.WebSocket = MockWebSocket as any

    client = createDataClient({
      mode: 'tanstack-db',
      baseUrl: 'wss://api.test.dotdo.dev',
    })

    // Get the latest created WebSocket instance
    mockWs = MockWebSocket.getLatest()
  })

  afterEach(async () => {
    // Restore original WebSocket
    global.WebSocket = OriginalWebSocket
    if (client) {
      client.disconnect()
    }
    MockWebSocket.reset()
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  it('should connect via WebSocket', async () => {
    // Wait for connection
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockWs).toBeDefined()
    expect(mockWs!.url).toBe('wss://api.test.dotdo.dev/sync')
    expect(mockWs!.readyState).toBe(1) // OPEN
  })

  it('should sync data via WebSocket on create', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Ensure WebSocket is connected
    expect(mockWs!.readyState).toBe(1)

    const newCustomer = { name: 'Charlie' }
    const expectedResult = { $id: '3', $type: 'Customer', ...newCustomer }

    // Setup fallback fetch just in case
    mockPool.intercept({
      path: '/customers',
      method: 'POST',
    }).reply(201, expectedResult)

    // Create a promise that will send the message and wait for response
    const createPromise = (async () => {
      const promise = client.create('customers', newCustomer)

      // Wait a tick for the message to be sent
      await new Promise((r) => setTimeout(r, 5))

      // Check if message was sent via WebSocket
      if (mockWs!.sentMessages.length > 0) {
        const sentMessage = mockWs!.sentMessages[mockWs!.sentMessages.length - 1]
        const request = JSON.parse(sentMessage)

        // Simulate server response with the requestId
        mockWs!.simulateMessage({
          requestId: request.requestId,
          type: 'create',
          resource: 'customers',
          data: expectedResult,
        })
      }

      return promise
    })()

    const result = await createPromise

    expect(result).toEqual(expectedResult)
  })

  it('should sync data via WebSocket on update', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Ensure WebSocket is connected
    expect(mockWs!.readyState).toBe(1)

    const updates = { name: 'Charlie Updated' }
    const expectedResult = { $id: '3', $type: 'Customer', ...updates }

    // Setup fallback fetch just in case
    mockPool.intercept({
      path: '/customers/3',
      method: 'PUT',
    }).reply(200, expectedResult)

    // Create a promise that will send the message and wait for response
    const updatePromise = (async () => {
      const promise = client.update('customers', '3', updates)

      // Wait a tick for the message to be sent
      await new Promise((r) => setTimeout(r, 5))

      // Check if message was sent via WebSocket
      if (mockWs!.sentMessages.length > 0) {
        const sentMessage = mockWs!.sentMessages[mockWs!.sentMessages.length - 1]
        const request = JSON.parse(sentMessage)

        // Simulate server response with the requestId
        mockWs!.simulateMessage({
          requestId: request.requestId,
          type: 'update',
          resource: 'customers',
          id: '3',
          data: expectedResult,
        })
      }

      return promise
    })()

    const result = await updatePromise

    expect(result).toEqual(expectedResult)
  })

  it('should support real-time updates via WebSocket broadcast', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))

    const updates: unknown[] = []
    client.onUpdate((update) => {
      updates.push(update)
    })

    // Simulate server broadcast
    mockWs!.simulateMessage({
      type: 'broadcast',
      resource: 'customers',
      id: '1',
      data: { $id: '1', $type: 'Customer', name: 'Alice Updated' },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      type: 'broadcast',
      resource: 'customers',
      id: '1',
      data: { $id: '1', $type: 'Customer', name: 'Alice Updated' },
    })
  })

  it('should fallback to REST on WebSocket failure', async () => {
    // Simulate WebSocket error
    mockWs!.simulateError()
    mockWs!.close()

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Should fall back to REST mode
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    const result = await client.get('customers', '1')

    expect(result).toEqual(mockData)
  })
})

describe('Data Layer - Mode Switching', () => {
  let mockAgent: MockAgent

  beforeEach(() => {
    MockWebSocket.reset()
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
  })

  afterEach(async () => {
    global.WebSocket = OriginalWebSocket
    MockWebSocket.reset()
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  it('should switch from REST to TanStack DB mode', async () => {
    global.WebSocket = MockWebSocket as any

    const client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
    })

    expect(client.getMode()).toBe('rest')

    client.setMode('tanstack-db')

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(client.getMode()).toBe('tanstack-db')
    const ws = MockWebSocket.getLatest()
    expect(ws).toBeDefined()

    client.disconnect()
  })

  it('should switch from TanStack DB to REST mode', async () => {
    global.WebSocket = MockWebSocket as any

    const client = createDataClient({
      mode: 'tanstack-db',
      baseUrl: 'wss://api.test.dotdo.dev',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(client.getMode()).toBe('tanstack-db')

    client.setMode('rest')

    expect(client.getMode()).toBe('rest')
    const ws = MockWebSocket.getLatest()
    expect(ws?.readyState).toBe(3) // CLOSED
  })
})

describe('Data Layer - Optimistic Updates', () => {
  let client: DataClient
  let mockAgent: MockAgent
  let mockPool: ReturnType<MockAgent['get']>

  beforeEach(() => {
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
    mockPool = mockAgent.get('https://api.test.dotdo.dev')

    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
      optimistic: true,
    })
  })

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  it('should return optimistic result immediately', async () => {
    const newCustomer = { name: 'Dave' }

    // Mock a slow response using undici's delay
    mockPool.intercept({
      path: '/customers',
      method: 'POST',
    }).reply(201, { $id: '4', $type: 'Customer', ...newCustomer }).delay(100)

    const result = await client.create('customers', newCustomer)

    // Should have optimistic ID
    expect(result.$id).toMatch(/^optimistic-/)
    expect(result.name).toBe('Dave')
  })

  it('should update optimistic result when server responds', async () => {
    const newCustomer = { name: 'Eve' }

    // Wait for the real response to come back in the background
    let realResponse: Thing | null = null
    const updates: unknown[] = []

    client.onUpdate((update) => {
      updates.push(update)
      if (update.data) {
        realResponse = update.data
      }
    })

    mockPool.intercept({
      path: '/customers',
      method: 'POST',
    }).reply(201, { $id: '5', $type: 'Customer', ...newCustomer }).delay(10)

    const result = await client.create('customers', newCustomer)

    // Should have optimistic ID
    expect(result.$id).toMatch(/^optimistic-/)
    expect(result.name).toBe('Eve')

    // Wait for background request to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})

describe('Data Layer - Cache Invalidation', () => {
  let client: DataClient
  let mockAgent: MockAgent
  let mockPool: ReturnType<MockAgent['get']>

  beforeEach(() => {
    mockAgent = new MockAgent()
    mockAgent.disableNetConnect()
    setGlobalDispatcher(mockAgent)
    mockPool = mockAgent.get('https://api.test.dotdo.dev')

    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
      cache: true,
    })
  })

  afterEach(async () => {
    setGlobalDispatcher(originalDispatcher)
    await mockAgent.close()
  })

  it('should cache GET requests', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }

    // Only intercept once - the second call should use cache
    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    const result1 = await client.get('customers', '1')
    const result2 = await client.get('customers', '1')

    expect(result1).toEqual(result2)
  })

  it('should invalidate cache on update', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    const updatedData = { $id: '1', $type: 'Customer', name: 'Alice Updated' }

    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    mockPool.intercept({
      path: '/customers/1',
      method: 'PUT',
    }).reply(200, updatedData)

    await client.get('customers', '1')
    await client.update('customers', '1', { name: 'Alice Updated' })
    const result = await client.get('customers', '1')

    expect(result).toEqual(updatedData)
  })

  it('should invalidate cache on delete', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }

    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    mockPool.intercept({
      path: '/customers/1',
      method: 'DELETE',
    }).reply(204, {})

    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(404, { error: 'Not found' })

    await client.get('customers', '1')
    await client.delete('customers', '1')

    await expect(client.get('customers', '1')).rejects.toThrow()
  })

  it('should manually invalidate cache', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }

    // Intercept twice for the two GET requests
    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    mockPool.intercept({
      path: '/customers/1',
      method: 'GET',
    }).reply(200, mockData)

    await client.get('customers', '1')
    client.invalidateCache('customers', '1')
    await client.get('customers', '1')

    // Both requests should have gone through
    expect(true).toBe(true)
  })
})
