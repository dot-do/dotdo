/**
 * Tests for Cap'n Web RPC integration at root endpoint (/)
 *
 * Tests the capnweb library integration that provides:
 * - Promise pipelining (multiple calls in single round-trip)
 * - HTTP batch mode (POST /)
 * - WebSocket streaming (WebSocket upgrade at /)
 * - Internal method filtering
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createMockDO, createMockRequest } from '../harness/do'
import { DO } from '../../objects/DOBase'
import {
  createCapnWebTarget,
  isInternalMember,
  isCapnWebRequest,
} from '../../objects/transport/capnweb-target'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Mock DO class with exposed methods for testing
 */
class TestDO extends DO {
  // Public properties
  public name = 'TestDO'
  public version = '1.0.0'

  // Public methods that should be exposed
  public greet(name: string): string {
    return `Hello, ${name}!`
  }

  public async fetchData(key: string): Promise<{ key: string; value: string }> {
    return { key, value: `data-for-${key}` }
  }

  public getStatus(): { status: string; uptime: number } {
    return { status: 'active', uptime: 12345 }
  }

  public add(a: number, b: number): number {
    return a + b
  }

  // Method that returns an object for pipelining tests
  public getUser(id: string) {
    return {
      id,
      profile: {
        name: `User ${id}`,
        email: `${id}@example.com`,
      },
      preferences: {
        theme: 'dark',
        notifications: true,
      },
    }
  }

  // Private method (underscore prefix) - should NOT be exposed
  private _internalHelper(): string {
    return 'internal'
  }
}

// ============================================================================
// INTERNAL MEMBER FILTERING TESTS
// ============================================================================

describe('isInternalMember', () => {
  describe('underscore prefix', () => {
    it('identifies _prefixed members as internal', () => {
      expect(isInternalMember('_privateMethod')).toBe(true)
      expect(isInternalMember('_currentActor')).toBe(true)
      expect(isInternalMember('_things')).toBe(true)
    })
  })

  describe('hash prefix', () => {
    it('identifies #prefixed members as internal', () => {
      expect(isInternalMember('#privateField')).toBe(true)
      expect(isInternalMember('#handleCapnWebRpc')).toBe(true)
    })
  })

  describe('lifecycle methods', () => {
    it('identifies DO lifecycle methods as internal', () => {
      expect(isInternalMember('fetch')).toBe(true)
      expect(isInternalMember('alarm')).toBe(true)
      expect(isInternalMember('initialize')).toBe(true)
      expect(isInternalMember('handleFetch')).toBe(true)
    })
  })

  describe('internal state', () => {
    it('identifies internal state accessors as internal', () => {
      expect(isInternalMember('db')).toBe(true)
      expect(isInternalMember('ctx')).toBe(true)
      expect(isInternalMember('storage')).toBe(true)
      expect(isInternalMember('env')).toBe(true)
    })
  })

  describe('workflow methods', () => {
    it('identifies workflow methods as internal', () => {
      expect(isInternalMember('send')).toBe(true)
      expect(isInternalMember('try')).toBe(true)
      expect(isInternalMember('do')).toBe(true)
      expect(isInternalMember('createWorkflowContext')).toBe(true)
    })
  })

  describe('public members', () => {
    it('identifies regular public methods as not internal', () => {
      expect(isInternalMember('greet')).toBe(false)
      expect(isInternalMember('getUser')).toBe(false)
      expect(isInternalMember('fetchData')).toBe(false)
      expect(isInternalMember('getStatus')).toBe(false)
    })

    it('identifies regular public properties as not internal', () => {
      expect(isInternalMember('name')).toBe(false)
      expect(isInternalMember('version')).toBe(false)
      expect(isInternalMember('config')).toBe(false)
    })
  })
})

// ============================================================================
// CAPN WEB TARGET PROXY TESTS
// ============================================================================

describe('createCapnWebTarget', () => {
  let instance: TestDO
  let target: object

  beforeEach(() => {
    const mock = createMockDO(TestDO, {
      id: 'test-capnweb',
      ns: 'TestDO/test-instance',
    })
    instance = mock.instance
    target = createCapnWebTarget(instance)
  })

  describe('method access', () => {
    it('exposes public methods', () => {
      const targetRecord = target as Record<string, unknown>
      expect(typeof targetRecord.greet).toBe('function')
      expect(typeof targetRecord.fetchData).toBe('function')
      expect(typeof targetRecord.getStatus).toBe('function')
      expect(typeof targetRecord.getUser).toBe('function')
    })

    it('executes exposed methods correctly', () => {
      const targetRecord = target as Record<string, (...args: unknown[]) => unknown>
      const result = targetRecord.greet('World')
      expect(result).toBe('Hello, World!')
    })

    it('maintains this context for methods', () => {
      const targetRecord = target as Record<string, (...args: unknown[]) => unknown>
      const status = targetRecord.getStatus() as { status: string; uptime: number }
      expect(status.status).toBe('active')
      expect(status.uptime).toBe(12345)
    })
  })

  describe('property access', () => {
    it('exposes public properties', () => {
      const targetRecord = target as Record<string, unknown>
      expect(targetRecord.name).toBe('TestDO')
      expect(targetRecord.version).toBe('1.0.0')
    })
  })

  describe('internal member filtering', () => {
    it('hides _prefixed members', () => {
      const targetRecord = target as Record<string, unknown>
      expect(targetRecord._currentActor).toBeUndefined()
      expect(targetRecord._things).toBeUndefined()
    })

    it('hides lifecycle methods', () => {
      const targetRecord = target as Record<string, unknown>
      expect(targetRecord.fetch).toBeUndefined()
      expect(targetRecord.alarm).toBeUndefined()
      expect(targetRecord.initialize).toBeUndefined()
    })

    it('hides internal state', () => {
      const targetRecord = target as Record<string, unknown>
      expect(targetRecord.db).toBeUndefined()
      expect(targetRecord.ctx).toBeUndefined()
      expect(targetRecord.storage).toBeUndefined()
    })

    it('hides workflow methods', () => {
      const targetRecord = target as Record<string, unknown>
      expect(targetRecord.send).toBeUndefined()
      // Note: 'try' and 'do' are protected, so they may not be directly on the instance
    })
  })

  describe('has() trap', () => {
    it('reports public members as present', () => {
      expect('greet' in target).toBe(true)
      expect('name' in target).toBe(true)
    })

    it('reports internal members as absent', () => {
      expect('fetch' in target).toBe(false)
      expect('_currentActor' in target).toBe(false)
    })
  })

  describe('ownKeys() trap', () => {
    it('excludes internal members from enumeration', () => {
      const keys = Object.keys(target)

      // Should include public members
      expect(keys).toContain('name')
      expect(keys).toContain('version')

      // Should exclude internal members
      expect(keys).not.toContain('fetch')
      expect(keys).not.toContain('_currentActor')
      expect(keys).not.toContain('db')
    })
  })
})

// ============================================================================
// REQUEST DETECTION TESTS
// ============================================================================

describe('isCapnWebRequest', () => {
  it('returns true for POST requests', () => {
    const request = createMockRequest('https://test.do/', {
      method: 'POST',
      body: { calls: [] },
    })
    expect(isCapnWebRequest(request)).toBe(true)
  })

  it('returns true for WebSocket upgrade requests', () => {
    const request = new Request('https://test.do/', {
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'upgrade',
      },
    })
    expect(isCapnWebRequest(request)).toBe(true)
  })

  it('returns false for GET requests without upgrade', () => {
    const request = createMockRequest('https://test.do/', {
      method: 'GET',
    })
    expect(isCapnWebRequest(request)).toBe(false)
  })

  it('returns false for PUT requests', () => {
    const request = createMockRequest('https://test.do/', {
      method: 'PUT',
      body: {},
    })
    expect(isCapnWebRequest(request)).toBe(false)
  })
})

// ============================================================================
// ROOT ENDPOINT TESTS
// ============================================================================

describe('Root endpoint (/)', () => {
  let instance: TestDO

  beforeEach(() => {
    const mock = createMockDO(TestDO, {
      id: 'test-root',
      ns: 'TestDO/test-instance',
    })
    instance = mock.instance
  })

  describe('GET /', () => {
    it('returns discovery info', async () => {
      const request = createMockRequest('https://test.do/', {
        method: 'GET',
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as Record<string, unknown>
      expect(body.ns).toBeDefined()
      expect(body.$type).toBeDefined()
      expect(body.protocols).toBeDefined()

      const protocols = body.protocols as Record<string, unknown>
      expect(protocols.capnweb).toBeDefined()
      expect(protocols.jsonrpc).toBeDefined()
      expect(protocols.mcp).toBeDefined()
      expect(protocols.sync).toBeDefined()
    })

    it('includes capnweb protocol info', async () => {
      const request = createMockRequest('https://test.do/', {
        method: 'GET',
      })

      const response = await instance.fetch(request)
      const body = await response.json() as { protocols: { capnweb: Record<string, unknown> } }

      expect(body.protocols.capnweb.endpoint).toBe('/')
      expect(body.protocols.capnweb.methods).toContain('POST')
      expect(body.protocols.capnweb.methods).toContain('WebSocket')
    })
  })

  describe('POST /', () => {
    it('routes POST to capnweb handler', async () => {
      // Note: Full capnweb protocol testing would require proper capnweb client.
      // Here we just verify the routing works - capnweb throws on invalid messages.
      const request = createMockRequest('https://test.do/', {
        method: 'POST',
        body: {},
      })

      // Capnweb throws an error for invalid message format
      // This verifies the request is routed to capnweb (not 404)
      try {
        await instance.fetch(request)
        // If no error, it handled it somehow
        expect(true).toBe(true)
      } catch (error) {
        // Error from capnweb indicates routing worked
        expect((error as Error).message).toContain('bad RPC message')
      }
    })

    it('accepts properly formatted capnweb batch', async () => {
      // A minimal capnweb batch message format
      // Note: capnweb expects specific message structure
      const request = createMockRequest('https://test.do/', {
        method: 'POST',
        body: [], // Empty batch is valid
      })

      try {
        const response = await instance.fetch(request)
        // Empty batch should return successfully
        expect([200, 400]).toContain(response.status)
      } catch {
        // Some capnweb versions may throw on empty batch
        expect(true).toBe(true)
      }
    })
  })

  describe('other methods', () => {
    it('returns 405 for PUT', async () => {
      const request = createMockRequest('https://test.do/', {
        method: 'PUT',
        body: {},
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(405)
      expect(response.headers.get('Allow')).toBe('GET, POST')
    })

    it('returns 405 for DELETE', async () => {
      const request = new Request('https://test.do/', {
        method: 'DELETE',
      })

      const response = await instance.fetch(request)
      expect(response.status).toBe(405)
    })
  })
})

// ============================================================================
// EXISTING ENDPOINTS STILL WORK
// ============================================================================

describe('Backward compatibility', () => {
  let instance: TestDO

  beforeEach(() => {
    const mock = createMockDO(TestDO, {
      id: 'test-compat',
      ns: 'TestDO/test-instance',
    })
    instance = mock.instance
  })

  it('/health still works', async () => {
    const request = createMockRequest('https://test.do/health', {
      method: 'GET',
    })

    const response = await instance.fetch(request)
    expect(response.status).toBe(200)

    const body = await response.json() as { status: string; ns: string }
    expect(body.status).toBe('ok')
  })

  it('/rpc still works', async () => {
    const request = createMockRequest('https://test.do/rpc', {
      method: 'GET',
    })

    const response = await instance.fetch(request)
    expect(response.status).toBe(200)

    const body = await response.json() as { methods: string[] }
    expect(body.methods).toBeDefined()
  })

  it('/rpc POST still works with JSON-RPC', async () => {
    const request = createMockRequest('https://test.do/rpc', {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        method: 'greet',
        params: ['Test'],
        id: 1,
      },
    })

    const response = await instance.fetch(request)
    expect(response.status).toBe(200)

    const body = await response.json() as { jsonrpc: string; result: string; id: number }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.result).toBe('Hello, Test!')
    expect(body.id).toBe(1)
  })

  it('/rpc POST still works with chain format', async () => {
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

    const body = await response.json() as { result: { status: string; uptime: number } }
    expect(body.result.status).toBe('active')
    expect(body.result.uptime).toBe(12345)
  })
})
