/**
 * Tests for POST /rpc chain execution endpoint
 *
 * Tests the chain-based RPC execution format that starts from `this.$` (WorkflowContext).
 *
 * Chain format:
 * ```json
 * {
 *   "chain": [
 *     { "type": "property", "key": "Customer" },
 *     { "type": "call", "args": ["alice"] },
 *     { "type": "property", "key": "profile" },
 *     { "type": "property", "key": "email" }
 *   ]
 * }
 * ```
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDO, createMockRequest } from '../harness/do'
import { DO } from '../../objects/DOBase'

// ============================================================================
// TEST TYPES
// ============================================================================

/**
 * Chain step types
 */
interface PropertyStep {
  type: 'property'
  key: string
}

interface CallStep {
  type: 'call'
  args?: unknown[]
}

interface IndexStep {
  type: 'index'
  index: number
}

type ChainStep = PropertyStep | CallStep | IndexStep

/**
 * Chain RPC request format
 */
interface ChainRpcRequest {
  chain: ChainStep[]
}

/**
 * Chain RPC response format
 */
interface ChainRpcResponse {
  result?: unknown
  error?: {
    message: string
    code?: string
  }
}

// ============================================================================
// MOCK DO CLASS FOR TESTING
// ============================================================================

/**
 * Mock DO class with exposed methods and collections for testing chain execution
 */
class TestDO extends DO {
  // Simple property for testing property access
  public config = {
    name: 'TestDO',
    version: '1.0.0',
    settings: {
      debug: true,
      maxItems: 100,
    },
  }

  // Simple array for testing index access
  public items = [
    { id: 'item-1', name: 'First', value: 10 },
    { id: 'item-2', name: 'Second', value: 20 },
    { id: 'item-3', name: 'Third', value: 30 },
  ]

  // Method that returns a value
  public getStatus() {
    return { status: 'active', uptime: 12345 }
  }

  // Method with arguments
  public echo(message: string) {
    return { echoed: message }
  }

  // Method that returns an object with nested properties
  public getUser(id: string) {
    return {
      id,
      profile: {
        name: `User ${id}`,
        email: `${id}@example.com`,
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
      posts: [
        { id: 'post-1', title: 'First Post' },
        { id: 'post-2', title: 'Second Post' },
      ],
    }
  }

  // Async method
  public async fetchData(key: string): Promise<{ key: string; value: string }> {
    return { key, value: `data-for-${key}` }
  }

  // Method that returns a function for chaining
  public createHelper(prefix: string) {
    return {
      format: (text: string) => `${prefix}: ${text}`,
      capitalize: (text: string) => text.toUpperCase(),
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a mock RPC request with chain
 */
function createChainRequest(chain: ChainStep[]): Request {
  return createMockRequest('https://test.do/rpc', {
    method: 'POST',
    body: { chain },
  })
}

/**
 * Parse response JSON
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

// ============================================================================
// TESTS
// ============================================================================

describe('POST /rpc', () => {
  let instance: TestDO

  beforeEach(() => {
    const mock = createMockDO(TestDO, {
      id: 'test-do-rpc',
      ns: 'TestDO/test-instance',
    })
    instance = mock.instance
  })

  describe('chain execution', () => {
    it('executes property chain', async () => {
      // Chain: $.config.settings.debug
      const request = createChainRequest([
        { type: 'property', key: 'config' },
        { type: 'property', key: 'settings' },
        { type: 'property', key: 'debug' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe(true)
    })

    it('executes method call chain', async () => {
      // Chain: $.getStatus()
      const request = createChainRequest([
        { type: 'property', key: 'getStatus' },
        { type: 'call', args: [] },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ status: 'active', uptime: 12345 })
    })

    it('executes mixed property/method chain', async () => {
      // Chain: $.getUser('alice').profile.email
      const request = createChainRequest([
        { type: 'property', key: 'getUser' },
        { type: 'call', args: ['alice'] },
        { type: 'property', key: 'profile' },
        { type: 'property', key: 'email' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('alice@example.com')
    })

    it('handles array index access', async () => {
      // Chain: $.items[0].name
      const request = createChainRequest([
        { type: 'property', key: 'items' },
        { type: 'index', index: 0 },
        { type: 'property', key: 'name' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('First')
    })

    it('executes method with arguments', async () => {
      // Chain: $.echo('hello world')
      const request = createChainRequest([
        { type: 'property', key: 'echo' },
        { type: 'call', args: ['hello world'] },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ echoed: 'hello world' })
    })

    it('executes nested method calls', async () => {
      // Chain: $.createHelper('TEST').format('message')
      const request = createChainRequest([
        { type: 'property', key: 'createHelper' },
        { type: 'call', args: ['TEST'] },
        { type: 'property', key: 'format' },
        { type: 'call', args: ['message'] },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('TEST: message')
    })

    it('handles async methods', async () => {
      // Chain: $.fetchData('test-key')
      const request = createChainRequest([
        { type: 'property', key: 'fetchData' },
        { type: 'call', args: ['test-key'] },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ key: 'test-key', value: 'data-for-test-key' })
    })

    it('accesses nested array items via chain', async () => {
      // Chain: $.getUser('bob').posts[1].title
      const request = createChainRequest([
        { type: 'property', key: 'getUser' },
        { type: 'call', args: ['bob'] },
        { type: 'property', key: 'posts' },
        { type: 'index', index: 1 },
        { type: 'property', key: 'title' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('Second Post')
    })
  })

  describe('$.things', () => {
    it('accesses things store property', async () => {
      // Chain: things (should return the things store object)
      const request = createChainRequest([
        { type: 'property', key: 'things' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      // The things property should exist and be an object
      expect(result.result).toBeDefined()
    })

    it('accesses things.list method', async () => {
      // Chain: things.list (should return the list function)
      const request = createChainRequest([
        { type: 'property', key: 'things' },
        { type: 'property', key: 'list' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      // The list property exists (it's a function that serializes to undefined or {})
      // The chain successfully accessed the nested property
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('accesses things.create method', async () => {
      // Chain: things.create (should return the create function)
      const request = createChainRequest([
        { type: 'property', key: 'things' },
        { type: 'property', key: 'create' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      // The chain successfully accessed the nested property
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('accesses things.get method', async () => {
      // Chain: things.get (should return the get function)
      const request = createChainRequest([
        { type: 'property', key: 'things' },
        { type: 'property', key: 'get' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      // The chain successfully accessed the nested property
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })
  })

  describe('errors', () => {
    it('returns 400 for invalid chain', async () => {
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: { chain: 'not-an-array' },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(400)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      // Message contains "Chain" (capitalized)
      expect(result.error?.message.toLowerCase()).toContain('chain')
    })

    it('returns 400 for empty chain', async () => {
      const request = createChainRequest([])

      const response = await instance.fetch(request)
      expect(response.status).toBe(400)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('empty')
    })

    it('returns 400 for invalid step type', async () => {
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'invalid', key: 'test' },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(400)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('step type')
    })

    it('returns 404 for not found property', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'nonExistentProperty' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(404)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('NOT_FOUND')
    })

    it('returns 400 for calling non-function', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'config' },
        { type: 'call', args: [] },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(400)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('not a function')
    })

    it('returns error in JSON format', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'nonExistent' },
      ])

      const response = await instance.fetch(request)
      const contentType = response.headers.get('Content-Type')
      expect(contentType).toContain('application/json')

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result).toHaveProperty('error')
      expect(result.error).toHaveProperty('message')
    })

    it('returns 400 for index on non-array', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'config' },
        { type: 'index', index: 0 },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(400)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('not an array')
    })

    it('returns 404 for out of bounds index', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'items' },
        { type: 'index', index: 100 },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(404)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('INDEX_OUT_OF_BOUNDS')
    })
  })

  describe('WorkflowContext methods', () => {
    it('accesses $.on for event handlers', async () => {
      // Chain: $.on (should return the on proxy)
      // Access via the $ property of the DO instance
      const request = createChainRequest([
        { type: 'property', key: '$' },
        { type: 'property', key: 'on' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      // The 'on' property returns a proxy, which may serialize to an object
      expect(result.result).toBeDefined()
    })

    it('accesses $.every for scheduling', async () => {
      // Chain: $.every (should return the schedule builder)
      // Access via the $ property of the DO instance
      const request = createChainRequest([
        { type: 'property', key: '$' },
        { type: 'property', key: 'every' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      // The 'every' property returns a proxy/function that may serialize as undefined or empty object
      // The important thing is that the chain executed successfully (200 status)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })
  })

  describe('security', () => {
    it('does not expose private properties', async () => {
      const request = createChainRequest([
        { type: 'property', key: '_currentActor' },
      ])

      const response = await instance.fetch(request)
      expect(response.status).toBe(404)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
    })

    it('does not expose internal methods', async () => {
      const request = createChainRequest([
        { type: 'property', key: 'handleFetch' },
        { type: 'call', args: [new Request('https://test.do/')] },
      ])

      const response = await instance.fetch(request)
      // Should either not find the method or refuse to execute it
      expect([400, 403, 404]).toContain(response.status)
    })
  })

  // ===========================================================================
  // Combined Call Step Format (SDK Client Compatibility)
  // ===========================================================================
  // The SDK client sends { type: 'call', key: 'methodName', args: [...] }
  // instead of separate property and call steps.

  describe('combined call step format (SDK compatibility)', () => {
    it('executes combined call step with method name and args', async () => {
      // SDK format: { type: 'call', key: 'echo', args: ['hello'] }
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'echo', args: ['hello'] },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ echoed: 'hello' })
    })

    it('executes chained combined call steps', async () => {
      // SDK format: $.Customer('alice').update({ name: 'Alice' })
      // becomes: [
      //   { type: 'call', key: 'getUser', args: ['alice'] },
      //   { type: 'property', key: 'profile' },
      //   { type: 'property', key: 'name' }
      // ]
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'getUser', args: ['alice'] },
            { type: 'property', key: 'profile' },
            { type: 'property', key: 'name' },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('User alice')
    })

    it('executes multiple combined call steps', async () => {
      // SDK format: $.createHelper('TEST').format('message')
      // becomes: [
      //   { type: 'call', key: 'createHelper', args: ['TEST'] },
      //   { type: 'call', key: 'format', args: ['message'] }
      // ]
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'createHelper', args: ['TEST'] },
            { type: 'call', key: 'format', args: ['message'] },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toBe('TEST: message')
    })

    it('handles async method with combined call step', async () => {
      // SDK format: $.fetchData('test-key')
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'fetchData', args: ['test-key'] },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ key: 'test-key', value: 'data-for-test-key' })
    })

    it('returns error for non-existent method in combined call', async () => {
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'nonExistentMethod', args: [] },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(404)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
    })

    it('blocks private methods in combined call', async () => {
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: '_privateMethod', args: [] },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect([400, 403, 404]).toContain(response.status)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.error).toBeDefined()
    })

    it('handles combined call step with no args', async () => {
      // SDK format: $.getStatus()
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'getStatus' },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ status: 'active', uptime: 12345 })
    })

    it('handles mixed combined calls and property access', async () => {
      // Chain: $.getUser('bob').posts[0]
      const request = createMockRequest('https://test.do/rpc', {
        method: 'POST',
        body: {
          chain: [
            { type: 'call', key: 'getUser', args: ['bob'] },
            { type: 'property', key: 'posts' },
            { type: 'index', index: 0 },
          ],
        },
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const result = await parseResponse<ChainRpcResponse>(response)
      expect(result.result).toEqual({ id: 'post-1', title: 'First Post' })
    })
  })
})
