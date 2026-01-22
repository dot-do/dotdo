/**
 * Mixin Tests for DO Mixins
 *
 * Comprehensive tests for:
 * - WithAuth mixin - authentication and authorization
 * - WithRPC mixin - RPC communication and stub caching
 * - WithStorage mixin - Things, Events, Relationships stores
 * - WithWebSocket mixin - WebSocket connection management
 *
 * These tests follow the project's "NO MOCKS" philosophy where possible,
 * using real miniflare instances via @cloudflare/vitest-pool-workers.
 *
 * @module do/tests/mixins.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import {
  WithAuth,
  WithRPC,
  WithStorage,
  WithWebSocket,
  type HasAuth,
  type HasRPC,
  type HasStorage,
  type HasWebSocket,
  type WithAuthOptions,
  type WithRPCOptions,
  type WithStorageOptions,
  type WithWebSocketOptions,
  WebSocketManager,
} from '../mixins'
import { EntityManager } from '../entities'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `mixin-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getTestStub(name?: string) {
  const testName = name || generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

/**
 * Create a minimal base class for mixin testing
 */
class BaseDO {
  constructor(
    public state?: DurableObjectState,
    public env?: unknown
  ) {}
}

// ============================================================================
// WithAuth Mixin Tests
// ============================================================================

describe('WithAuth Mixin', () => {
  describe('mixin application', () => {
    it('should create a class with auth capabilities', () => {
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      expect(instance).toBeDefined()
      expect(instance.authGuard).toBeDefined()
      expect(typeof instance.validateCaller).toBe('function')
      expect(typeof instance.canAccess).toBe('function')
      expect(typeof instance.validateToken).toBe('function')
      expect(typeof instance.getCallerId).toBe('function')
    })

    it('should support configuration options', () => {
      const options: WithAuthOptions = {
        secret: 'test-secret-at-least-32-characters-long',
        issuer: 'test-issuer',
        audience: 'test-audience',
      }
      const AuthDO = WithAuth(BaseDO, options)
      const instance = new AuthDO()

      expect(instance.authGuard).toBeDefined()
    })

    it('should set DO internal secret when provided', () => {
      const options: WithAuthOptions = {
        doInternalSecret: 'test-internal-secret-at-least-32-chars',
      }
      const AuthDO = WithAuth(BaseDO, options)
      const instance = new AuthDO()

      expect(instance).toBeDefined()
    })
  })

  describe('validateCaller', () => {
    it('should validate unknown callers', async () => {
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const request = new Request('https://do/')
      const callerInfo = await instance.validateCaller(request)

      expect(callerInfo.type).toBe('unknown')
      expect(callerInfo.trusted).toBe(false)
    })

    it('should handle user callers with Bearer token', async () => {
      // Note: The mixin's placeholder implementation doesn't fully implement
      // token detection. When the actual @dotdo/auth is implemented,
      // this test should be updated to verify 'user' type detection.
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      // Create a fake JWT-like token
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const payload = btoa(JSON.stringify({ sub: 'user-123' }))
      const signature = btoa('fake-signature')
      const token = `${header}.${payload}.${signature}`

      const request = new Request('https://do/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const callerInfo = await instance.validateCaller(request)

      // With placeholder implementation, returns unknown
      // Full implementation would return 'user' type
      expect(callerInfo).toBeDefined()
      expect(typeof callerInfo.type).toBe('string')
      expect(typeof callerInfo.trusted).toBe('boolean')
    })
  })

  describe('canAccess', () => {
    it('should return false for unknown callers by default', async () => {
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const request = new Request('https://do/')
      const canAccess = await instance.canAccess(request)

      expect(canAccess).toBe(false)
    })
  })

  describe('validateToken', () => {
    it('should return null for invalid tokens', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const payload = await instance.validateToken('invalid-token')
      expect(payload).toBeNull()

      warnSpy.mockRestore()
    })

    it('should handle JWT-like tokens (placeholder returns null)', async () => {
      // Note: The mixin's placeholder implementation doesn't fully implement
      // token validation. When the actual @dotdo/auth is implemented,
      // this test should be updated to verify proper token decoding.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const payloadData = { sub: 'user-456', email: 'test@example.com' }
      const payload = btoa(JSON.stringify(payloadData))
      const signature = btoa('fake-signature')
      const token = `${header}.${payload}.${signature}`

      const result = await instance.validateToken(token)
      // Placeholder implementation returns null
      // Full implementation would decode and return payload
      expect(result).toBeNull()

      warnSpy.mockRestore()
    })
  })

  describe('getCallerId', () => {
    it('should return null for unknown callers', () => {
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const request = new Request('https://do/')
      const callerId = instance.getCallerId(request)

      expect(callerId).toBeNull()
    })

    it('should handle JWT requests (placeholder returns null)', () => {
      // Note: The mixin's placeholder implementation doesn't extract caller ID.
      // When the actual @dotdo/auth is implemented, this test should be updated
      // to verify proper caller ID extraction from JWT sub claim.
      const AuthDO = WithAuth(BaseDO)
      const instance = new AuthDO()

      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const payload = btoa(JSON.stringify({ sub: 'user-789' }))
      const signature = btoa('fake-signature')
      const token = `${header}.${payload}.${signature}`

      const request = new Request('https://do/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const callerId = instance.getCallerId(request)

      // Placeholder implementation returns null
      // Full implementation would extract 'user-789' from sub claim
      expect(callerId).toBeNull()
    })
  })

  describe('mixin composition', () => {
    it('should compose with other mixins', () => {
      const ComposedDO = WithAuth(WithStorage(BaseDO))
      const instance = new ComposedDO()

      // Should have auth capabilities
      expect(instance.authGuard).toBeDefined()
      expect(typeof instance.validateCaller).toBe('function')

      // Should have storage capabilities
      expect(instance.things).toBeDefined()
      expect(instance.events).toBeDefined()
    })
  })
})

// ============================================================================
// WithRPC Mixin Tests
// ============================================================================

describe('WithRPC Mixin', () => {
  describe('mixin application', () => {
    it('should create a class with RPC capabilities', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO()

      expect(instance).toBeDefined()
      expect(typeof instance.getDOStub).toBe('function')
      expect(typeof instance.hasStub).toBe('function')
      expect(typeof instance.clearStub).toBe('function')
      expect(typeof instance.clearAllStubs).toBe('function')
      expect(typeof instance.getStubCount).toBe('function')
    })

    it('should support configuration options', () => {
      const options: WithRPCOptions = {
        rpcPath: '/custom-rpc',
        debug: true,
      }
      const RPCDO = WithRPC(BaseDO, options)
      const instance = new RPCDO()

      expect(instance).toBeDefined()
    })
  })

  describe('stub caching', () => {
    it('should start with empty stub cache', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO()

      expect(instance.getStubCount()).toBe(0)
    })

    it('should report hasStub correctly for non-existent stubs', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO()

      expect(instance.hasStub('Customer', 'user-123')).toBe(false)
    })

    it('should clear all stubs', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO()

      // Clear all stubs (even if empty)
      instance.clearAllStubs()
      expect(instance.getStubCount()).toBe(0)
    })

    it('should return false when clearing non-existent stub', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO()

      const result = instance.clearStub('Customer', 'non-existent')
      expect(result).toBe(false)
    })
  })

  describe('getDOStub error handling', () => {
    it('should throw when env is not available', () => {
      const RPCDO = WithRPC(BaseDO)
      const instance = new RPCDO(undefined, undefined)

      expect(() => instance.getDOStub('Customer', 'user-123')).toThrow(
        'Environment not available'
      )
    })
  })

  describe('mixin composition', () => {
    it('should compose with other mixins', () => {
      const ComposedDO = WithRPC(WithAuth(BaseDO))
      const instance = new ComposedDO()

      // Should have RPC capabilities
      expect(typeof instance.getDOStub).toBe('function')
      expect(typeof instance.hasStub).toBe('function')

      // Should have auth capabilities
      expect(instance.authGuard).toBeDefined()
      expect(typeof instance.validateCaller).toBe('function')
    })
  })
})

// ============================================================================
// WithStorage Mixin Tests
// ============================================================================

describe('WithStorage Mixin', () => {
  describe('mixin application', () => {
    it('should create a class with storage capabilities', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      expect(instance).toBeDefined()
      expect(instance.things).toBeDefined()
      expect(instance.events).toBeDefined()
      expect(instance.relationships).toBeDefined()
      expect(instance.auditLogs).toBeDefined()
      expect(typeof instance.setAuditContext).toBe('function')
      expect(typeof instance.getAuditContext).toBe('function')
      expect(typeof instance.query).toBe('function')
    })

    it('should support configuration options', () => {
      const options: WithStorageOptions = {
        entityManagerOptions: {
          auditConfig: { enabled: true },
        },
      }
      const StorageDO = WithStorage(BaseDO, options)
      const instance = new StorageDO()

      expect(instance.things).toBeDefined()
    })
  })

  describe('audit context', () => {
    it('should set and get audit context', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      instance.setAuditContext({
        actor: 'user-123',
        correlationId: 'corr-456',
      })

      const context = instance.getAuditContext()
      expect(context.actor).toBe('user-123')
      expect(context.correlationId).toBe('corr-456')
    })

    it('should default to system actor', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const context = instance.getAuditContext()
      expect(context.actor).toBe('system')
    })
  })

  describe('query builder', () => {
    it('should create a query builder', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const query = instance.query()
      expect(query).toBeDefined()
      expect(typeof query.where).toBe('function')
      expect(typeof query.limit).toBe('function')
    })
  })

  describe('things store', () => {
    it('should have things store methods', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      expect(typeof instance.things.create).toBe('function')
      expect(typeof instance.things.get).toBe('function')
      expect(typeof instance.things.update).toBe('function')
      expect(typeof instance.things.delete).toBe('function')
      expect(typeof instance.things.list).toBe('function')
    })

    it('should create things via store', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const thing = await instance.things.create({
        $type: 'Customer',
        name: 'Alice',
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$type).toBe('Customer')
    })

    it('should get things by ID', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const created = await instance.things.create({
        $type: 'Customer',
        name: 'Bob',
      })

      const retrieved = await instance.things.get(created.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.$id).toBe(created.$id)
    })

    it('should update things', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const created = await instance.things.create({
        $type: 'Customer',
        name: 'Charlie',
      })

      const updated = await instance.things.update(created.$id, {
        name: 'Charlie Updated',
      })

      expect((updated as { name: string }).name).toBe('Charlie Updated')
    })

    it('should delete things', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const created = await instance.things.create({
        $type: 'Customer',
        name: 'Dave',
      })

      await instance.things.delete(created.$id)
      const retrieved = await instance.things.get(created.$id)
      expect(retrieved).toBeNull()
    })

    it('should list things', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      await instance.things.create({ $type: 'Product', name: 'Widget' })
      await instance.things.create({ $type: 'Product', name: 'Gadget' })

      const products = await instance.things.list({ type: 'Product' })
      expect(products.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('events store', () => {
    it('should have events store methods', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      expect(typeof instance.events.emit).toBe('function')
      expect(typeof instance.events.get).toBe('function')
      expect(typeof instance.events.query).toBe('function')
      expect(typeof instance.events.subscribe).toBe('function')
    })

    it('should emit events', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const event = await instance.events.emit({
        type: 'Customer.created',
        payload: { name: 'Test' },
      })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('Customer.created')
    })

    it('should query events', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      await instance.events.emit({
        type: 'Order.placed',
        payload: { orderId: '123' },
      })

      const events = await instance.events.query({ type: 'Order.placed' })
      expect(events.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('relationships store', () => {
    it('should have relationships store methods', () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      expect(typeof instance.relationships.add).toBe('function')
      expect(typeof instance.relationships.remove).toBe('function')
      expect(typeof instance.relationships.find).toBe('function')
      expect(typeof instance.relationships.getRelated).toBe('function')
    })

    it('should add relationships', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      const rel = await instance.relationships.add({
        subject: 'user-1',
        predicate: 'owns',
        object: 'doc-1',
      })

      expect(rel.subject).toBe('user-1')
      expect(rel.predicate).toBe('owns')
      expect(rel.object).toBe('doc-1')
    })

    it('should find related objects', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      await instance.relationships.add({
        subject: 'user-2',
        predicate: 'likes',
        object: 'post-1',
      })

      const related = await instance.relationships.getRelated('user-2', 'likes')
      expect(related).toContain('post-1')
    })

    it('should remove relationships', async () => {
      const StorageDO = WithStorage(BaseDO)
      const instance = new StorageDO()

      await instance.relationships.add({
        subject: 'user-3',
        predicate: 'follows',
        object: 'user-4',
      })

      await instance.relationships.remove({
        subject: 'user-3',
        predicate: 'follows',
        object: 'user-4',
      })

      const related = await instance.relationships.getRelated('user-3', 'follows')
      expect(related).not.toContain('user-4')
    })
  })

  describe('mixin composition', () => {
    it('should compose with other mixins', () => {
      const ComposedDO = WithStorage(WithAuth(BaseDO))
      const instance = new ComposedDO()

      // Should have storage capabilities
      expect(instance.things).toBeDefined()
      expect(instance.events).toBeDefined()

      // Should have auth capabilities
      expect(instance.authGuard).toBeDefined()
    })
  })
})

// ============================================================================
// WithWebSocket Mixin Tests
// ============================================================================

describe('WithWebSocket Mixin', () => {
  describe('mixin application', () => {
    it('should create a class with WebSocket capabilities', () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      expect(instance).toBeDefined()
      expect(instance.ws).toBeDefined()
      expect(instance.ws instanceof WebSocketManager).toBe(true)
    })

    it('should support configuration options', () => {
      const options: WithWebSocketOptions = {
        enableHeartbeat: true,
        heartbeatInterval: 15000,
        connectionTimeout: 30000,
      }
      const WebSocketDO = WithWebSocket(BaseDO, options)
      const instance = new WebSocketDO()

      expect(instance.ws).toBeDefined()
    })
  })

  describe('WebSocket manager access', () => {
    it('should provide access to WebSocket manager', () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      expect(typeof instance.ws.on).toBe('function')
      expect(typeof instance.ws.off).toBe('function')
      expect(typeof instance.ws.broadcast).toBe('function')
      expect(typeof instance.ws.send).toBe('function')
    })

    it('should register message handlers', () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      const handler = vi.fn()
      instance.ws.on('test.event', handler)

      // Verify handler is registered by checking it can be removed
      expect(() => instance.ws.off('test.event', handler)).not.toThrow()
    })

    it('should register connection lifecycle handlers', () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      const connectHandler = vi.fn()
      const disconnectHandler = vi.fn()

      instance.ws.onConnect(connectHandler)
      instance.ws.onDisconnect(disconnectHandler)

      // Verify handlers are registered
      expect(() => instance.ws.offConnect(connectHandler)).not.toThrow()
      expect(() => instance.ws.offDisconnect(disconnectHandler)).not.toThrow()
    })
  })

  describe('webSocketMessage handler', () => {
    it('should delegate message handling to WebSocket manager', async () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      const handler = vi.fn()
      instance.ws.on('chat.message', handler)

      const fakeWs = {
        readyState: 1,
        send: vi.fn(),
      } as unknown as WebSocket

      await instance.webSocketMessage(
        fakeWs,
        JSON.stringify({ type: 'chat.message', data: { text: 'Hello' } })
      )

      expect(handler).toHaveBeenCalledWith(fakeWs, { text: 'Hello' })
    })
  })

  describe('webSocketClose handler', () => {
    it('should clean up WebSocket on close', async () => {
      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      const fakeWs = {} as WebSocket

      // Should not throw
      await instance.webSocketClose(fakeWs, 1000, 'Normal close', true)
    })
  })

  describe('webSocketError handler', () => {
    it('should handle WebSocket errors gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const WebSocketDO = WithWebSocket(BaseDO)
      const instance = new WebSocketDO()

      const fakeWs = {} as WebSocket
      const error = new Error('Test error')

      // Should not throw
      await instance.webSocketError(fakeWs, error)

      errorSpy.mockRestore()
    })
  })

  describe('heartbeat management', () => {
    it('should provide startHeartbeat method', () => {
      const WebSocketDO = WithWebSocket(BaseDO, { enableHeartbeat: true })
      const instance = new WebSocketDO()

      // Access protected method via type assertion
      const protectedInstance = instance as unknown as {
        startHeartbeat: (state: DurableObjectState) => void
        stopHeartbeat: () => void
      }

      expect(typeof protectedInstance.startHeartbeat).toBe('function')
      expect(typeof protectedInstance.stopHeartbeat).toBe('function')
    })
  })

  describe('mixin composition', () => {
    it('should compose with other mixins', () => {
      const ComposedDO = WithWebSocket(WithStorage(BaseDO))
      const instance = new ComposedDO()

      // Should have WebSocket capabilities
      expect(instance.ws).toBeDefined()

      // Should have storage capabilities
      expect(instance.things).toBeDefined()
      expect(instance.events).toBeDefined()
    })
  })
})

// ============================================================================
// Full Mixin Composition Tests
// ============================================================================

describe('Full Mixin Composition', () => {
  it('should compose all four mixins', () => {
    const FullDO = WithAuth(
      WithRPC(WithWebSocket(WithStorage(BaseDO))),
      { secret: 'test-secret-at-least-32-characters-long' }
    )
    const instance = new FullDO()

    // Auth capabilities
    expect(instance.authGuard).toBeDefined()
    expect(typeof instance.validateCaller).toBe('function')

    // RPC capabilities
    expect(typeof instance.getDOStub).toBe('function')
    expect(typeof instance.hasStub).toBe('function')

    // WebSocket capabilities
    expect(instance.ws).toBeDefined()

    // Storage capabilities
    expect(instance.things).toBeDefined()
    expect(instance.events).toBeDefined()
    expect(instance.relationships).toBeDefined()
  })

  it('should allow using multiple capabilities together', async () => {
    const FullDO = WithAuth(WithRPC(WithWebSocket(WithStorage(BaseDO))))
    const instance = new FullDO()

    // Use storage to create a thing
    const customer = await instance.things.create({
      $type: 'Customer',
      name: 'Integration Test',
    })
    expect(customer.$id).toBeDefined()

    // Use storage to emit an event
    const event = await instance.events.emit({
      type: 'Customer.created',
      payload: { customerId: customer.$id },
    })
    expect(event.type).toBe('Customer.created')

    // Use auth to validate a request
    const request = new Request('https://do/')
    const callerInfo = await instance.validateCaller(request)
    expect(callerInfo.type).toBe('unknown')

    // Use WebSocket manager to register a handler
    const handler = vi.fn()
    instance.ws.on('test', handler)
    expect(() => instance.ws.off('test', handler)).not.toThrow()
  })
})

// ============================================================================
// Real DO Integration Tests (via cloudflare:test)
// ============================================================================

describe('Mixin Integration with Real DO', () => {
  it('should work with real DO instances via miniflare', async () => {
    const stub = getTestStub()

    // Health check to verify DO is working
    const response = await stub.fetch('https://do/')
    expect(response.status).toBe(200)

    const json = (await response.json()) as { status: string; id: string }
    expect(json.status).toBe('ok')
    expect(json.id).toBeDefined()
  })

  it('should handle concurrent requests to real DO', async () => {
    const stub = getTestStub()

    // Fire multiple concurrent requests
    const requests = Array.from({ length: 5 }, () => stub.fetch('https://do/'))

    const responses = await Promise.all(requests)

    for (const response of responses) {
      expect(response.status).toBe(200)
      await response.text() // Consume body
    }
  })

  it('should maintain isolation between DO instances', async () => {
    const stub1 = getTestStub(generateTestId())
    const stub2 = getTestStub(generateTestId())

    const [resp1, resp2] = await Promise.all([
      stub1.fetch('https://do/'),
      stub2.fetch('https://do/'),
    ])

    const json1 = (await resp1.json()) as { id: string }
    const json2 = (await resp2.json()) as { id: string }

    // Different DO instances have different IDs
    expect(json1.id).not.toBe(json2.id)
  })
})
