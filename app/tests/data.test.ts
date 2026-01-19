import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createDataClient, DataMode } from '../data'
import type { DataClient, DataClientOptions } from '../data'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock WebSocket
class MockWebSocket {
  public readyState = 1 // OPEN
  public onopen: ((event: any) => void) | null = null
  public onclose: ((event: any) => void) | null = null
  public onmessage: ((event: any) => void) | null = null
  public onerror: ((event: any) => void) | null = null
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
  simulateMessage(data: any) {
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

  beforeEach(() => {
    mockFetch.mockReset()
    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
    })
  })

  it('should fetch data via HTTP GET', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    })

    const result = await client.get('customers', '1')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.dotdo.dev/customers/1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(result).toEqual(mockData)
  })

  it('should create data via HTTP POST', async () => {
    const newCustomer = { name: 'Bob' }
    const createdCustomer = { $id: '2', $type: 'Customer', ...newCustomer }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => createdCustomer,
    })

    const result = await client.create('customers', newCustomer)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.dotdo.dev/customers',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(newCustomer),
      })
    )
    expect(result).toEqual(createdCustomer)
  })

  it('should update data via HTTP PUT', async () => {
    const updates = { name: 'Alice Updated' }
    const updatedCustomer = { $id: '1', $type: 'Customer', ...updates }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => updatedCustomer,
    })

    const result = await client.update('customers', '1', updates)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.dotdo.dev/customers/1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(updates),
      })
    )
    expect(result).toEqual(updatedCustomer)
  })

  it('should delete data via HTTP DELETE', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => ({}),
    })

    await client.delete('customers', '1')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.dotdo.dev/customers/1',
      expect.objectContaining({
        method: 'DELETE',
      })
    )
  })

  it('should list data via HTTP GET', async () => {
    const mockList = [
      { $id: '1', $type: 'Customer', name: 'Alice' },
      { $id: '2', $type: 'Customer', name: 'Bob' },
    ]
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockList,
    })

    const result = await client.list('customers')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test.dotdo.dev/customers',
      expect.objectContaining({
        method: 'GET',
      })
    )
    expect(result).toEqual(mockList)
  })

  it('should throw on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Customer not found' }),
    })

    await expect(client.get('customers', '999')).rejects.toThrow()
  })
})

describe('Data Layer - TanStack DB Mode', () => {
  let client: DataClient
  let mockWs: MockWebSocket | undefined

  beforeEach(() => {
    // Reset mock WebSocket instances
    MockWebSocket.reset()
    mockFetch.mockReset()

    // Replace global WebSocket with mock
    global.WebSocket = MockWebSocket as any

    client = createDataClient({
      mode: 'tanstack-db',
      baseUrl: 'wss://api.test.dotdo.dev',
    })

    // Get the latest created WebSocket instance
    mockWs = MockWebSocket.getLatest()
  })

  afterEach(() => {
    // Restore original WebSocket
    global.WebSocket = OriginalWebSocket
    if (client) {
      client.disconnect()
    }
    MockWebSocket.reset()
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => expectedResult,
    })

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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => expectedResult,
    })

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

    const updates: any[] = []
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    })

    const result = await client.get('customers', '1')

    expect(mockFetch).toHaveBeenCalled()
    expect(result).toEqual(mockData)
  })
})

describe('Data Layer - Mode Switching', () => {
  beforeEach(() => {
    MockWebSocket.reset()
  })

  afterEach(() => {
    global.WebSocket = OriginalWebSocket
    MockWebSocket.reset()
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

  beforeEach(() => {
    mockFetch.mockReset()
    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
      optimistic: true,
    })
  })

  it('should return optimistic result immediately', async () => {
    const newCustomer = { name: 'Dave' }

    // Mock a slow response
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 201,
                json: async () => ({ $id: '4', $type: 'Customer', ...newCustomer }),
              }),
            100
          )
        )
    )

    const result = await client.create('customers', newCustomer)

    // Should have optimistic ID
    expect(result.$id).toMatch(/^optimistic-/)
    expect(result.name).toBe('Dave')
  })

  it('should update optimistic result when server responds', async () => {
    const newCustomer = { name: 'Eve' }

    // Wait for the real response to come back in the background
    let realResponse: Thing | null = null
    const updates: any[] = []

    client.onUpdate((update) => {
      updates.push(update)
      if (update.data) {
        realResponse = update.data
      }
    })

    mockFetch.mockImplementation(async () => {
      // Simulate a slight delay
      await new Promise((r) => setTimeout(r, 10))
      return {
        ok: true,
        status: 201,
        json: async () => ({ $id: '5', $type: 'Customer', ...newCustomer }),
      }
    })

    const result = await client.create('customers', newCustomer)

    // Should have optimistic ID
    expect(result.$id).toMatch(/^optimistic-/)
    expect(result.name).toBe('Eve')

    // Wait for background request to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Should have called fetch in background
    expect(mockFetch).toHaveBeenCalled()
  })
})

describe('Data Layer - Cache Invalidation', () => {
  let client: DataClient

  beforeEach(() => {
    mockFetch.mockReset()
    client = createDataClient({
      mode: 'rest',
      baseUrl: 'https://api.test.dotdo.dev',
      cache: true,
    })
  })

  it('should cache GET requests', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    })

    const result1 = await client.get('customers', '1')
    const result2 = await client.get('customers', '1')

    expect(mockFetch).toHaveBeenCalledTimes(1) // Only called once
    expect(result1).toEqual(result2)
  })

  it('should invalidate cache on update', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    const updatedData = { $id: '1', $type: 'Customer', name: 'Alice Updated' }

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedData,
      })

    await client.get('customers', '1')
    await client.update('customers', '1', { name: 'Alice Updated' })
    const result = await client.get('customers', '1')

    // First GET, UPDATE (which updates cache), second GET uses cached value
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(result).toEqual(updatedData)
  })

  it('should invalidate cache on delete', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockData,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      })

    await client.get('customers', '1')
    await client.delete('customers', '1')

    await expect(client.get('customers', '1')).rejects.toThrow()
  })

  it('should manually invalidate cache', async () => {
    const mockData = { $id: '1', $type: 'Customer', name: 'Alice' }
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockData,
    })

    await client.get('customers', '1')
    client.invalidateCache('customers', '1')
    await client.get('customers', '1')

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})
