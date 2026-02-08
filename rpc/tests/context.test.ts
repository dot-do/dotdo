/**
 * Tests for $Context — request-scoped context for RPC/WebSocket (do-99vxp)
 *
 * Covers:
 * - Context creation and factory
 * - Immutability enforcement
 * - Header serialization/deserialization
 * - WebSocket context association
 * - Context derivation
 * - Permission and capability checks
 * - Anonymous context creation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createContext,
  createAnonymousContext,
  contextToHeaders,
  contextFromHeaders,
  setWebSocketContext,
  getWebSocketContext,
  clearWebSocketContext,
  deriveContext,
  hasPermission,
  hasCapability,
  CONTEXT_HEADERS,
  type $Context,
  type $ContextInput,
} from '../context'
import { CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from '../headers'

// ============================================================================
// Context Creation
// ============================================================================

describe('$Context', () => {
  describe('createContext', () => {
    it('should create a context with all fields', () => {
      const input: $ContextInput = {
        correlationId: 'corr-123',
        tenantId: 'acme',
        userId: 'user_abc',
        agentId: 'agent_xyz',
        sessionId: 'sess_456',
        permissions: ['read', 'write'],
        capabilities: ['crm:contacts:create', 'billing:subscriptions:read'],
        trusted: true,
        sourceDoId: 'do-123',
        request: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          origin: 'https://app.example.com',
          colo: 'SFO',
          timestamp: '2024-01-15T10:00:00.000Z',
          country: 'US',
        },
      }

      const ctx = createContext(input)

      expect(ctx.correlationId).toBe('corr-123')
      expect(ctx.tenantId).toBe('acme')
      expect(ctx.userId).toBe('user_abc')
      expect(ctx.agentId).toBe('agent_xyz')
      expect(ctx.sessionId).toBe('sess_456')
      expect(ctx.permissions).toEqual(['read', 'write'])
      expect(ctx.capabilities).toEqual(['crm:contacts:create', 'billing:subscriptions:read'])
      expect(ctx.trusted).toBe(true)
      expect(ctx.sourceDoId).toBe('do-123')
      expect(ctx.request.ip).toBe('192.168.1.1')
      expect(ctx.request.userAgent).toBe('Mozilla/5.0')
      expect(ctx.request.origin).toBe('https://app.example.com')
      expect(ctx.request.colo).toBe('SFO')
      expect(ctx.request.timestamp).toBe('2024-01-15T10:00:00.000Z')
      expect(ctx.request.country).toBe('US')
    })

    it('should generate correlationId when not provided', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(ctx.correlationId).toBeDefined()
      expect(ctx.correlationId.length).toBeGreaterThan(0)
    })

    it('should generate unique correlationIds', () => {
      const ctx1 = createContext({ tenantId: 'acme' })
      const ctx2 = createContext({ tenantId: 'acme' })
      expect(ctx1.correlationId).not.toBe(ctx2.correlationId)
    })

    it('should default permissions and capabilities to empty arrays', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(ctx.permissions).toEqual([])
      expect(ctx.capabilities).toEqual([])
    })

    it('should default trusted to false', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(ctx.trusted).toBe(false)
    })

    it('should default optional fields to undefined', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(ctx.userId).toBeUndefined()
      expect(ctx.agentId).toBeUndefined()
      expect(ctx.sessionId).toBeUndefined()
      expect(ctx.sourceDoId).toBeUndefined()
    })

    it('should generate a timestamp in request metadata when not provided', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(ctx.request.timestamp).toBeDefined()
      // Should be a valid ISO timestamp
      const parsed = new Date(ctx.request.timestamp)
      expect(parsed.getTime()).not.toBeNaN()
    })
  })

  // ============================================================================
  // Immutability
  // ============================================================================

  describe('immutability', () => {
    it('should freeze the context object', () => {
      const ctx = createContext({
        tenantId: 'acme',
        userId: 'user_abc',
        permissions: ['read'],
      })

      expect(Object.isFrozen(ctx)).toBe(true)
    })

    it('should freeze the permissions array', () => {
      const ctx = createContext({
        tenantId: 'acme',
        permissions: ['read', 'write'],
      })

      expect(Object.isFrozen(ctx.permissions)).toBe(true)
    })

    it('should freeze the capabilities array', () => {
      const ctx = createContext({
        tenantId: 'acme',
        capabilities: ['crm:read'],
      })

      expect(Object.isFrozen(ctx.capabilities)).toBe(true)
    })

    it('should freeze the request metadata', () => {
      const ctx = createContext({
        tenantId: 'acme',
        request: { ip: '1.2.3.4' },
      })

      expect(Object.isFrozen(ctx.request)).toBe(true)
    })

    it('should prevent modification of top-level properties', () => {
      const ctx = createContext({ tenantId: 'acme', userId: 'user_abc' })

      expect(() => {
        ;(ctx as Record<string, unknown>).tenantId = 'other'
      }).toThrow()
    })

    it('should prevent modification of permissions array', () => {
      const ctx = createContext({
        tenantId: 'acme',
        permissions: ['read'],
      })

      expect(() => {
        ;(ctx.permissions as string[]).push('admin')
      }).toThrow()
    })

    it('should prevent modification of capabilities array', () => {
      const ctx = createContext({
        tenantId: 'acme',
        capabilities: ['crm:read'],
      })

      expect(() => {
        ;(ctx.capabilities as string[]).push('billing:write')
      }).toThrow()
    })

    it('should not be affected by mutation of input arrays', () => {
      const permissions: ('read' | 'write')[] = ['read']
      const capabilities = ['crm:read']

      const ctx = createContext({
        tenantId: 'acme',
        permissions,
        capabilities,
      })

      // Mutate original arrays
      permissions.push('write')
      capabilities.push('billing:write')

      // Context should not be affected
      expect(ctx.permissions).toEqual(['read'])
      expect(ctx.capabilities).toEqual(['crm:read'])
    })
  })

  // ============================================================================
  // Anonymous Context
  // ============================================================================

  describe('createAnonymousContext', () => {
    it('should create a context with read-only permission', () => {
      const ctx = createAnonymousContext('acme')

      expect(ctx.tenantId).toBe('acme')
      expect(ctx.permissions).toEqual(['read'])
      expect(ctx.capabilities).toEqual([])
      expect(ctx.trusted).toBe(false)
      expect(ctx.userId).toBeUndefined()
      expect(ctx.agentId).toBeUndefined()
    })

    it('should accept request metadata', () => {
      const ctx = createAnonymousContext('acme', {
        ip: '10.0.0.1',
        userAgent: 'TestBot/1.0',
      })

      expect(ctx.request.ip).toBe('10.0.0.1')
      expect(ctx.request.userAgent).toBe('TestBot/1.0')
    })

    it('should be immutable', () => {
      const ctx = createAnonymousContext('acme')
      expect(Object.isFrozen(ctx)).toBe(true)
    })
  })

  // ============================================================================
  // Header Serialization
  // ============================================================================

  describe('contextToHeaders', () => {
    it('should serialize all context fields to headers', () => {
      const ctx = createContext({
        correlationId: 'corr-abc',
        tenantId: 'acme',
        userId: 'user_123',
        agentId: 'agent_456',
        sessionId: 'sess_789',
        permissions: ['read', 'write'],
        capabilities: ['crm:contacts:create'],
        trusted: true,
        sourceDoId: 'do-xyz',
      })

      const headers = contextToHeaders(ctx)

      expect(headers[CORRELATION_ID_HEADER]).toBe('corr-abc')
      expect(headers[CONTEXT_HEADERS.TENANT_ID]).toBe('acme')
      expect(headers[CONTEXT_HEADERS.USER_ID]).toBe('user_123')
      expect(headers[CONTEXT_HEADERS.AGENT_ID]).toBe('agent_456')
      expect(headers[CONTEXT_HEADERS.SESSION_ID]).toBe('sess_789')
      expect(headers[CONTEXT_HEADERS.PERMISSIONS]).toBe('read,write')
      expect(headers[CONTEXT_HEADERS.CAPABILITIES]).toBe('crm:contacts:create')
      expect(headers[DO_SOURCE_HEADER]).toBe('true')
      expect(headers[DO_SOURCE_ID_HEADER]).toBe('do-xyz')
    })

    it('should omit undefined optional fields', () => {
      const ctx = createContext({ tenantId: 'acme' })
      const headers = contextToHeaders(ctx)

      expect(headers[CONTEXT_HEADERS.TENANT_ID]).toBe('acme')
      expect(CONTEXT_HEADERS.USER_ID in headers).toBe(false)
      expect(CONTEXT_HEADERS.AGENT_ID in headers).toBe(false)
      expect(CONTEXT_HEADERS.SESSION_ID in headers).toBe(false)
      expect(DO_SOURCE_HEADER in headers).toBe(false)
      expect(DO_SOURCE_ID_HEADER in headers).toBe(false)
    })

    it('should omit empty permissions and capabilities', () => {
      const ctx = createContext({ tenantId: 'acme' })
      const headers = contextToHeaders(ctx)

      expect(CONTEXT_HEADERS.PERMISSIONS in headers).toBe(false)
      expect(CONTEXT_HEADERS.CAPABILITIES in headers).toBe(false)
    })
  })

  // ============================================================================
  // Header Deserialization
  // ============================================================================

  describe('contextFromHeaders', () => {
    it('should deserialize context from Headers object', () => {
      const headers = new Headers({
        [CORRELATION_ID_HEADER]: 'corr-abc',
        [CONTEXT_HEADERS.TENANT_ID]: 'acme',
        [CONTEXT_HEADERS.USER_ID]: 'user_123',
        [CONTEXT_HEADERS.AGENT_ID]: 'agent_456',
        [CONTEXT_HEADERS.SESSION_ID]: 'sess_789',
        [CONTEXT_HEADERS.PERMISSIONS]: 'read,write',
        [CONTEXT_HEADERS.CAPABILITIES]: 'crm:contacts:create',
        [DO_SOURCE_HEADER]: 'true',
        [DO_SOURCE_ID_HEADER]: 'do-xyz',
      })

      const ctx = contextFromHeaders(headers)

      expect(ctx).not.toBeNull()
      expect(ctx!.correlationId).toBe('corr-abc')
      expect(ctx!.tenantId).toBe('acme')
      expect(ctx!.userId).toBe('user_123')
      expect(ctx!.agentId).toBe('agent_456')
      expect(ctx!.sessionId).toBe('sess_789')
      expect(ctx!.permissions).toEqual(['read', 'write'])
      expect(ctx!.capabilities).toEqual(['crm:contacts:create'])
      expect(ctx!.trusted).toBe(true)
      expect(ctx!.sourceDoId).toBe('do-xyz')
    })

    it('should deserialize context from plain object headers', () => {
      const headers: Record<string, string> = {
        [CONTEXT_HEADERS.TENANT_ID]: 'bigcorp',
        [CONTEXT_HEADERS.USER_ID]: 'user_abc',
      }

      const ctx = contextFromHeaders(headers)

      expect(ctx).not.toBeNull()
      expect(ctx!.tenantId).toBe('bigcorp')
      expect(ctx!.userId).toBe('user_abc')
    })

    it('should return null if tenant ID is missing', () => {
      const headers = new Headers({
        [CORRELATION_ID_HEADER]: 'corr-abc',
        [CONTEXT_HEADERS.USER_ID]: 'user_123',
      })

      const ctx = contextFromHeaders(headers)
      expect(ctx).toBeNull()
    })

    it('should return immutable context', () => {
      const headers = new Headers({
        [CONTEXT_HEADERS.TENANT_ID]: 'acme',
      })

      const ctx = contextFromHeaders(headers)
      expect(ctx).not.toBeNull()
      expect(Object.isFrozen(ctx!)).toBe(true)
    })

    it('should round-trip through serialization', () => {
      const original = createContext({
        correlationId: 'corr-roundtrip',
        tenantId: 'acme',
        userId: 'user_123',
        agentId: 'agent_456',
        sessionId: 'sess_789',
        permissions: ['read', 'write', 'admin'],
        capabilities: ['crm:contacts:create', 'billing:subscriptions:read'],
        trusted: true,
        sourceDoId: 'do-xyz',
      })

      const headers = contextToHeaders(original)
      const restored = contextFromHeaders(headers)

      expect(restored).not.toBeNull()
      expect(restored!.correlationId).toBe(original.correlationId)
      expect(restored!.tenantId).toBe(original.tenantId)
      expect(restored!.userId).toBe(original.userId)
      expect(restored!.agentId).toBe(original.agentId)
      expect(restored!.sessionId).toBe(original.sessionId)
      expect(restored!.permissions).toEqual([...original.permissions])
      expect(restored!.capabilities).toEqual([...original.capabilities])
      expect(restored!.trusted).toBe(original.trusted)
      expect(restored!.sourceDoId).toBe(original.sourceDoId)
    })

    it('should handle case-insensitive header lookup for plain objects', () => {
      const headers: Record<string, string> = {
        'x-context-tenant-id': 'acme',
        'x-context-user-id': 'user_123',
      }

      const ctx = contextFromHeaders(headers)
      expect(ctx).not.toBeNull()
      expect(ctx!.tenantId).toBe('acme')
      expect(ctx!.userId).toBe('user_123')
    })
  })

  // ============================================================================
  // WebSocket Context Association
  // ============================================================================

  describe('WebSocket context association', () => {
    // Create a minimal mock WebSocket for testing
    function createMockWebSocket(): WebSocket {
      return {
        readyState: 1,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      } as unknown as WebSocket
    }

    it('should associate and retrieve context from a WebSocket', () => {
      const ws = createMockWebSocket()
      const ctx = createContext({ tenantId: 'acme', userId: 'user_123' })

      setWebSocketContext(ws, ctx)
      const retrieved = getWebSocketContext(ws)

      expect(retrieved).toBe(ctx)
      expect(retrieved!.tenantId).toBe('acme')
      expect(retrieved!.userId).toBe('user_123')
    })

    it('should return undefined for unknown WebSocket', () => {
      const ws = createMockWebSocket()
      const retrieved = getWebSocketContext(ws)
      expect(retrieved).toBeUndefined()
    })

    it('should overwrite previous context for same WebSocket', () => {
      const ws = createMockWebSocket()
      const ctx1 = createContext({ tenantId: 'acme' })
      const ctx2 = createContext({ tenantId: 'bigcorp' })

      setWebSocketContext(ws, ctx1)
      setWebSocketContext(ws, ctx2)

      const retrieved = getWebSocketContext(ws)
      expect(retrieved!.tenantId).toBe('bigcorp')
    })

    it('should clear context for a WebSocket', () => {
      const ws = createMockWebSocket()
      const ctx = createContext({ tenantId: 'acme' })

      setWebSocketContext(ws, ctx)
      expect(getWebSocketContext(ws)).toBe(ctx)

      const cleared = clearWebSocketContext(ws)
      expect(cleared).toBe(true)
      expect(getWebSocketContext(ws)).toBeUndefined()
    })

    it('should return false when clearing non-existent context', () => {
      const ws = createMockWebSocket()
      const cleared = clearWebSocketContext(ws)
      expect(cleared).toBe(false)
    })

    it('should isolate contexts between different WebSockets', () => {
      const ws1 = createMockWebSocket()
      const ws2 = createMockWebSocket()
      const ctx1 = createContext({ tenantId: 'acme' })
      const ctx2 = createContext({ tenantId: 'bigcorp' })

      setWebSocketContext(ws1, ctx1)
      setWebSocketContext(ws2, ctx2)

      expect(getWebSocketContext(ws1)!.tenantId).toBe('acme')
      expect(getWebSocketContext(ws2)!.tenantId).toBe('bigcorp')
    })
  })

  // ============================================================================
  // Context Derivation
  // ============================================================================

  describe('deriveContext', () => {
    it('should create a child context preserving parent fields', () => {
      const parent = createContext({
        correlationId: 'corr-parent',
        tenantId: 'acme',
        userId: 'user_123',
        permissions: ['read', 'write'],
        capabilities: ['crm:read'],
      })

      const child = deriveContext(parent, {
        sourceDoId: 'do-child',
      })

      // Preserved from parent
      expect(child.correlationId).toBe('corr-parent')
      expect(child.tenantId).toBe('acme')
      expect(child.userId).toBe('user_123')
      expect(child.permissions).toEqual(['read', 'write'])
      expect(child.capabilities).toEqual(['crm:read'])

      // Added by override
      expect(child.sourceDoId).toBe('do-child')
    })

    it('should allow overriding parent fields', () => {
      const parent = createContext({
        tenantId: 'acme',
        userId: 'user_123',
        permissions: ['read'],
        trusted: false,
      })

      const child = deriveContext(parent, {
        userId: 'user_456',
        permissions: ['admin'],
        trusted: true,
      })

      expect(child.userId).toBe('user_456')
      expect(child.permissions).toEqual(['admin'])
      expect(child.trusted).toBe(true)
    })

    it('should create an immutable child context', () => {
      const parent = createContext({ tenantId: 'acme' })
      const child = deriveContext(parent, { sourceDoId: 'do-123' })

      expect(Object.isFrozen(child)).toBe(true)
    })

    it('should preserve parent correlationId (not generate new one)', () => {
      const parent = createContext({
        correlationId: 'trace-original',
        tenantId: 'acme',
      })

      const child = deriveContext(parent, {})
      expect(child.correlationId).toBe('trace-original')
    })
  })

  // ============================================================================
  // Permission and Capability Checks
  // ============================================================================

  describe('hasPermission', () => {
    it('should return true for existing permission', () => {
      const ctx = createContext({
        tenantId: 'acme',
        permissions: ['read', 'write'],
      })

      expect(hasPermission(ctx, 'read')).toBe(true)
      expect(hasPermission(ctx, 'write')).toBe(true)
    })

    it('should return false for missing permission', () => {
      const ctx = createContext({
        tenantId: 'acme',
        permissions: ['read'],
      })

      expect(hasPermission(ctx, 'admin')).toBe(false)
      expect(hasPermission(ctx, 'owner')).toBe(false)
    })

    it('should return false for empty permissions', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(hasPermission(ctx, 'read')).toBe(false)
    })
  })

  describe('hasCapability', () => {
    it('should return true for existing capability', () => {
      const ctx = createContext({
        tenantId: 'acme',
        capabilities: ['crm:contacts:create', 'billing:subscriptions:read'],
      })

      expect(hasCapability(ctx, 'crm:contacts:create')).toBe(true)
      expect(hasCapability(ctx, 'billing:subscriptions:read')).toBe(true)
    })

    it('should return false for missing capability', () => {
      const ctx = createContext({
        tenantId: 'acme',
        capabilities: ['crm:contacts:create'],
      })

      expect(hasCapability(ctx, 'crm:contacts:delete')).toBe(false)
    })

    it('should return false for empty capabilities', () => {
      const ctx = createContext({ tenantId: 'acme' })
      expect(hasCapability(ctx, 'anything')).toBe(false)
    })
  })
})
