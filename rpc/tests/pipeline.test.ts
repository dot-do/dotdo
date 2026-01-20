import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createPipeline,
  withPipeline,
  PipelineBuilder,
  executePipeline,
  withPipelineSupport,
  createPipelineClient,
  type PipelineRequest,
  type PipelineStep,
} from '../pipeline'
import { createServer } from '../server'

// ============================================================================
// Simple Pipeline Promise Tests (Client-side chaining)
// ============================================================================

describe('Pipeline/Promise Chaining', () => {
  describe('createPipeline', () => {
    it('should create a pipeline from a promise', async () => {
      const pipeline = createPipeline(Promise.resolve({ name: 'Alice', age: 30 }))
      const result = await pipeline

      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('should support .pipe() for transformations', async () => {
      const pipeline = createPipeline(Promise.resolve(5))
        .pipe(x => x * 2)
        .pipe(x => x + 1)

      expect(await pipeline).toBe(11)
    })

    it('should support .get() for property access', async () => {
      const pipeline = createPipeline(Promise.resolve({ user: { name: 'Bob' } }))
        .get('user')
        .get('name')

      expect(await pipeline).toBe('Bob')
    })

    it('should support .call() for method invocation', async () => {
      const obj = {
        items: [1, 2, 3],
        getTotal() { return this.items.reduce((a, b) => a + b, 0) }
      }

      const pipeline = createPipeline(Promise.resolve(obj))
        .call('getTotal')

      expect(await pipeline).toBe(6)
    })

    it('should chain multiple operations', async () => {
      const data = {
        users: [
          { name: 'Alice', score: 10 },
          { name: 'Bob', score: 20 }
        ],
        getUser(index: number) { return this.users[index] }
      }

      const result = await createPipeline(Promise.resolve(data))
        .call('getUser', 1)
        .get('name')

      expect(result).toBe('Bob')
    })

    it('should handle async pipe functions', async () => {
      const pipeline = createPipeline(Promise.resolve(5))
        .pipe(async x => {
          await new Promise(r => setTimeout(r, 10))
          return x * 2
        })

      expect(await pipeline).toBe(10)
    })
  })

  describe('withPipeline', () => {
    it('should wrap client methods to return pipelines', async () => {
      const client = {
        async getUser(id: string) {
          return { id, name: 'Test User' }
        }
      }

      const pipelinedClient = withPipeline(client)
      const name = await pipelinedClient.getUser('123').get('name')

      expect(name).toBe('Test User')
    })

    it('should allow chaining across multiple calls', async () => {
      const client = {
        async getOrder(id: string) {
          return { id, items: [{ name: 'Widget', price: 10 }] }
        }
      }

      const pipelinedClient = withPipeline(client)
      const items = await pipelinedClient.getOrder('order-1')
        .get('items')
        .pipe((items: { name: string; price: number }[]) => items.length)

      expect(items).toBe(1)
    })
  })
})

// ============================================================================
// Server-side Pipeline Execution Tests
// ============================================================================

describe('Server-side Pipeline Execution', () => {
  // Test target with nested objects and methods
  const target = {
    users: {
      get(id: string) {
        return {
          id,
          name: `User ${id}`,
          profile: {
            avatar: `https://avatar.example.com/${id}`,
            bio: `Bio for ${id}`
          },
          getProfile() {
            return this.profile
          },
          getOrders() {
            return [
              { id: `order-1`, total: 100 },
              { id: `order-2`, total: 200 }
            ]
          }
        }
      }
    },
    async getAccount(id: string) {
      return {
        id,
        balance: 1000,
        getBalance() {
          return this.balance
        },
        getHistory() {
          return [
            { date: '2024-01-01', amount: 100 },
            { date: '2024-01-02', amount: -50 }
          ]
        }
      }
    },
    math: {
      multiply(a: number, b: number) {
        return { result: a * b, format: () => `${a} * ${b}` }
      }
    }
  }

  describe('executePipeline', () => {
    it('should execute initial method without pipeline steps', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['123'],
        pipeline: []
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toMatchObject({
        id: '123',
        name: 'User 123'
      })
    })

    it('should execute pipeline with .get() steps', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['alice'],
        pipeline: [
          { type: 'get', name: 'profile' },
          { type: 'get', name: 'avatar' }
        ]
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toBe('https://avatar.example.com/alice')
    })

    it('should execute pipeline with .call() steps', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['bob'],
        pipeline: [
          { type: 'call', name: 'getProfile' },
          { type: 'get', name: 'bio' }
        ]
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toBe('Bio for bob')
    })

    it('should handle async initial methods', async () => {
      const request: PipelineRequest = {
        method: 'getAccount',
        args: ['acc-123'],
        pipeline: [
          { type: 'call', name: 'getBalance' }
        ]
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toBe(1000)
    })

    it('should chain multiple operations', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: [
          { type: 'call', name: 'getOrders' },
          { type: 'get', name: '0' },
          { type: 'get', name: 'total' }
        ]
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toBe(100)
    })

    it('should pass arguments to pipeline method calls', async () => {
      const request: PipelineRequest = {
        method: 'math.multiply',
        args: [3, 4],
        pipeline: [
          { type: 'get', name: 'result' }
        ]
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeUndefined()
      expect(response.result).toBe(12)
    })

    it('should return error with stepIndex for failed steps', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['alice'],
        pipeline: [
          { type: 'get', name: 'profile' },
          { type: 'get', name: 'nonexistent' },
          { type: 'get', name: 'another' }
        ]
      }

      const response = await executePipeline(target, request)

      // Step 1 (index 1) tries to access nonexistent property
      // This doesn't error - it just returns undefined
      // Step 2 (index 2) errors when accessing property on undefined
      expect(response.result).toBeUndefined()
    })

    it('should return error for non-existent method', async () => {
      const request: PipelineRequest = {
        method: 'nonexistent',
        args: [],
        pipeline: []
      }

      const response = await executePipeline(target, request)

      expect(response.error).toBeDefined()
      expect(response.error?.stepIndex).toBe(-1)
      expect(response.error?.message).toContain('not a function')
    })

    it('should enforce max depth limit', async () => {
      const deepPipeline: PipelineStep[] = Array(15).fill({ type: 'get', name: 'x' })
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: deepPipeline
      }

      const response = await executePipeline(target, request, { maxDepth: 10 })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('PIPELINE_TOO_DEEP')
    })

    it('should preserve correlation ID in response', async () => {
      const request: PipelineRequest = {
        method: 'users.get',
        args: ['test'],
        pipeline: [],
        correlationId: 'test-corr-123'
      }

      const response = await executePipeline(target, request)

      expect(response.correlationId).toBe('test-corr-123')
    })
  })

  describe('withPipelineSupport', () => {
    it('should add __pipeline__ method to target', async () => {
      const enhanced = withPipelineSupport(target)

      expect(typeof enhanced.__pipeline__).toBe('function')
    })

    it('should execute pipeline via __pipeline__ method', async () => {
      const enhanced = withPipelineSupport(target)

      const response = await enhanced.__pipeline__({
        method: 'users.get',
        args: ['alice'],
        pipeline: [
          { type: 'get', name: 'name' }
        ]
      })

      expect(response.result).toBe('User alice')
    })
  })
})

// ============================================================================
// PipelineBuilder Tests (Client-side builder for server execution)
// ============================================================================

describe('PipelineBuilder', () => {
  it('should build pipeline steps with .get()', async () => {
    // Create a mock transport
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: 'avatar-url',
        correlationId: 'test-123'
      })
    }

    const builder = new PipelineBuilder(
      mockTransport,
      'getUser',
      ['alice'],
      { timeout: 5000 }
    )

    const result = await builder.get('profile' as never).get('avatar' as never)

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      method: '__pipeline__',
      args: [expect.objectContaining({
        method: 'getUser',
        args: ['alice'],
        pipeline: [
          { type: 'get', name: 'profile' },
          { type: 'get', name: 'avatar' }
        ]
      })]
    }))

    expect(result).toBe('avatar-url')
  })

  it('should build pipeline steps with .call()', async () => {
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: { items: [] },
        correlationId: 'test-123'
      })
    }

    const builder = new PipelineBuilder(
      mockTransport,
      'getUser',
      ['bob'],
      {}
    )

    const result = await builder.call('getOrders' as never)

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      method: '__pipeline__',
      args: [expect.objectContaining({
        method: 'getUser',
        args: ['bob'],
        pipeline: [
          { type: 'call', name: 'getOrders', args: [] }
        ]
      })]
    }))
  })

  it('should support chaining .get() and .call()', async () => {
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: 'final-value',
        correlationId: 'test-123'
      })
    }

    const builder = new PipelineBuilder(
      mockTransport,
      'getUser',
      ['charlie'],
      {}
    )

    await builder
      .call('getProfile' as never)
      .get('settings' as never)
      .call('getValue' as never, 'theme' as never)

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      method: '__pipeline__',
      args: [expect.objectContaining({
        pipeline: [
          { type: 'call', name: 'getProfile', args: [] },
          { type: 'get', name: 'settings' },
          { type: 'call', name: 'getValue', args: ['theme'] }
        ]
      })]
    }))
  })

  it('should make direct call without pipeline steps', async () => {
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: { id: 'alice', name: 'Alice' },
        correlationId: 'test-123'
      })
    }

    const builder = new PipelineBuilder(
      mockTransport,
      'getUser',
      ['alice'],
      {}
    )

    const result = await builder // No chaining

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      method: 'getUser',
      args: ['alice']
    }))
    expect(mockTransport.send).not.toHaveBeenCalledWith(expect.objectContaining({
      method: '__pipeline__'
    }))
  })

  it('should be immutable (chaining creates new builders)', async () => {
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: 'value',
        correlationId: 'test-123'
      })
    }

    const builder1 = new PipelineBuilder(mockTransport, 'getUser', ['x'], {})
    const builder2 = builder1.get('profile' as never)
    const builder3 = builder1.get('settings' as never)

    // Builder 1 has no steps
    // Builder 2 has profile step
    // Builder 3 has settings step (not profile)
    await builder2

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      args: [expect.objectContaining({
        pipeline: [{ type: 'get', name: 'profile' }]
      })]
    }))
  })
})

// ============================================================================
// Integration Tests - Client + Server Pipeline
// ============================================================================

describe('Pipeline Integration', () => {
  const testTarget = {
    async getUser(id: string) {
      return {
        id,
        name: `User ${id}`,
        getProfile: () => ({
          avatar: `avatar-${id}.png`,
          bio: `Bio for ${id}`
        })
      }
    },
    users: {
      get(id: string) {
        return {
          id,
          profile: {
            name: `User ${id}`,
            avatar: `https://example.com/${id}.png`
          }
        }
      }
    }
  }

  it('should execute pipeline through RPC server endpoint', async () => {
    const server = createServer({ target: testTarget })

    // Make pipeline request
    const request = new Request('http://localhost/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'users.get',
        args: ['alice'],
        pipeline: [
          { type: 'get', name: 'profile' },
          { type: 'get', name: 'avatar' }
        ]
      })
    })

    const response = await server.fetch(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.result).toBe('https://example.com/alice.png')
  })

  it('should validate method path in pipeline endpoint', async () => {
    const server = createServer({ target: testTarget })

    const request = new Request('http://localhost/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: '_privateMethod',
        args: [],
        pipeline: []
      })
    })

    const response = await server.fetch(request)

    expect(response.status).toBe(403) // Authorization error for private method
  })

  it('should respect whitelist in pipeline endpoint', async () => {
    const server = createServer({
      target: testTarget,
      whitelist: ['users.get']
    })

    // Allowed method
    const allowedRequest = new Request('http://localhost/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'users.get',
        args: ['bob'],
        pipeline: []
      })
    })

    const allowedResponse = await server.fetch(allowedRequest)
    expect(allowedResponse.status).toBe(200)

    // Blocked method
    const blockedRequest = new Request('http://localhost/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'getUser',
        args: ['bob'],
        pipeline: []
      })
    })

    const blockedResponse = await server.fetch(blockedRequest)
    expect(blockedResponse.status).toBe(403)
  })

  it('should disable pipeline endpoint when enablePipeline is false', async () => {
    const server = createServer({
      target: testTarget,
      enablePipeline: false
    })

    const request = new Request('http://localhost/rpc/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'users.get',
        args: ['test'],
        pipeline: []
      })
    })

    const response = await server.fetch(request)

    // Should return 404 as the route doesn't exist
    expect(response.status).toBe(404)
  })
})

// ============================================================================
// Cap'n Proto Style Usage Tests
// ============================================================================

describe('Cap\'n Proto Style Promise Pipelining', () => {
  it('demonstrates the pipelining pattern', async () => {
    // This test documents the intended usage pattern
    //
    // WITHOUT pipelining (2 round trips):
    // const user = await client.getUser('123')  // Round trip 1
    // const profile = await user.getProfile()   // Round trip 2
    //
    // WITH pipelining (1 round trip):
    // const profile = await client.pipeline('getUser', '123')
    //   .call('getProfile')

    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: { name: 'Alice', bio: 'Hello world' },
        correlationId: 'test'
      })
    }

    // Simulate the pipelining client usage
    interface UserAPI {
      getUser(id: string): Promise<User>
    }

    interface User {
      getProfile(): Promise<Profile>
    }

    interface Profile {
      name: string
      bio: string
    }

    // Create pipeline and execute
    const pipeline = new PipelineBuilder<User>(
      mockTransport,
      'getUser',
      ['alice'],
      {}
    )

    // Chain the call - this accumulates pipeline steps
    const profilePipeline = pipeline.call('getProfile' as keyof User)

    // When awaited, sends single request with full pipeline
    await profilePipeline

    // Verify only ONE network call was made
    expect(mockTransport.send).toHaveBeenCalledTimes(1)

    // Verify the pipeline was properly batched
    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      method: '__pipeline__',
      args: [expect.objectContaining({
        method: 'getUser',
        args: ['alice'],
        pipeline: [
          { type: 'call', name: 'getProfile', args: [] }
        ]
      })]
    }))
  })

  it('supports deep pipelining chains', async () => {
    const mockTransport = {
      send: vi.fn().mockResolvedValue({
        result: 'https://cdn.example.com/alice-small.jpg',
        correlationId: 'test'
      })
    }

    // Deep chain: getUser().getProfile().avatar.thumbnails.small
    const pipeline = new PipelineBuilder(
      mockTransport,
      'getUser',
      ['alice'],
      {}
    )

    await pipeline
      .call('getProfile' as never)
      .get('avatar' as never)
      .get('thumbnails' as never)
      .get('small' as never)

    // Still only ONE network call
    expect(mockTransport.send).toHaveBeenCalledTimes(1)

    expect(mockTransport.send).toHaveBeenCalledWith(expect.objectContaining({
      args: [expect.objectContaining({
        pipeline: [
          { type: 'call', name: 'getProfile', args: [] },
          { type: 'get', name: 'avatar' },
          { type: 'get', name: 'thumbnails' },
          { type: 'get', name: 'small' }
        ]
      })]
    }))
  })
})
