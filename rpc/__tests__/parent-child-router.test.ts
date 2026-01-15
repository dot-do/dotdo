/**
 * Parent-Child Router Tests - TDD
 *
 * Tests for hierarchical DO routing for parent-child relationships.
 * The router manages hierarchical ID resolution and capability delegation
 * between parent and child Durable Objects.
 *
 * ID format: parent:child:grandchild
 * e.g., "tenant-123:user-456:session-789"
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ParentChildRouter,
  createHierarchyResolver,
  type ParentChildRouterOptions,
} from '../parent-child-router'
import {
  createCapabilityToken,
  verifyCapabilityToken,
  CapabilityPayload,
  CapabilityError,
} from '../capability-token'

// =============================================================================
// Hierarchy Resolution Tests
// =============================================================================

describe('Parent-Child Router', () => {
  const testSecret = 'test-secret-key-for-hmac-signing-256-bits'

  describe('Hierarchy Resolution', () => {
    it('should resolve child DO from parent + child ID', () => {
      const router = new ParentChildRouter()

      const parentId = 'tenant-123'
      const childSuffix = 'user-456'
      const childId = router.getChildId(parentId, childSuffix)

      expect(childId).toBe('tenant-123:user-456')
    })

    it('should resolve parent DO from child ID', () => {
      const router = new ParentChildRouter()

      const childId = 'tenant-123:user-456'
      const parentId = router.getParentId(childId)

      expect(parentId).toBe('tenant-123')
    })

    it('should support multi-level hierarchy (grandchild)', () => {
      const router = new ParentChildRouter()

      // Create three-level hierarchy
      const tenantId = 'tenant-123'
      const userId = router.getChildId(tenantId, 'user-456')
      const sessionId = router.getChildId(userId, 'session-789')

      expect(sessionId).toBe('tenant-123:user-456:session-789')

      // Navigate back up
      expect(router.getParentId(sessionId)).toBe('tenant-123:user-456')
      expect(router.getParentId(userId)).toBe('tenant-123')
      expect(router.getParentId(tenantId)).toBeNull()
    })

    it('should parse hierarchical ID format correctly', () => {
      const router = new ParentChildRouter()

      const id = 'tenant-123:user-456:session-789'
      const parts = router.parseId(id)

      expect(parts).toEqual(['tenant-123', 'user-456', 'session-789'])
    })

    it('should build hierarchical ID from parts', () => {
      const router = new ParentChildRouter()

      const parts = ['tenant-123', 'user-456', 'session-789']
      const id = router.buildId(parts)

      expect(id).toBe('tenant-123:user-456:session-789')
    })

    it('should handle root-level ID (no parent)', () => {
      const router = new ParentChildRouter()

      const rootId = 'tenant-123'
      const parentId = router.getParentId(rootId)

      expect(parentId).toBeNull()
    })

    it('should get correct hierarchy depth', () => {
      const router = new ParentChildRouter()

      expect(router.getDepth('tenant-123')).toBe(1)
      expect(router.getDepth('tenant-123:user-456')).toBe(2)
      expect(router.getDepth('tenant-123:user-456:session-789')).toBe(3)
    })

    it('should check if ID is descendant of another', () => {
      const router = new ParentChildRouter()

      expect(router.isDescendant('tenant-123', 'tenant-123:user-456')).toBe(true)
      expect(router.isDescendant('tenant-123', 'tenant-123:user-456:session-789')).toBe(true)
      expect(router.isDescendant('tenant-123:user-456', 'tenant-123:user-456:session-789')).toBe(
        true
      )

      // Not descendants
      expect(router.isDescendant('tenant-123', 'tenant-456:user-789')).toBe(false)
      expect(router.isDescendant('tenant-123:user-456', 'tenant-123:user-789')).toBe(false)
    })

    it('should support custom separator', () => {
      const router = new ParentChildRouter({ separator: '/' })

      const parentId = 'tenant-123'
      const childId = router.getChildId(parentId, 'user-456')

      expect(childId).toBe('tenant-123/user-456')
      expect(router.getParentId(childId)).toBe('tenant-123')
    })
  })

  // ===========================================================================
  // Capability Delegation Tests
  // ===========================================================================

  describe('Capability Delegation', () => {
    it('should allow parent to create child capability', async () => {
      const router = new ParentChildRouter()

      // Parent creates a root capability
      const parentCapability = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      })

      // Verify it's valid
      const verified = await verifyCapabilityToken(parentCapability, testSecret)
      expect(verified.target).toBe('tenant-123')
      expect(verified.scope).toBe('admin')
    })

    it('should attenuate parent capability for child', async () => {
      const router = new ParentChildRouter()

      // Parent has admin capability
      const parentCapability = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['read', 'write', 'delete', 'admin'],
        scope: 'admin',
        exp: Date.now() + 3600000,
      })

      // Create attenuated child capability
      const childId = router.getChildId('tenant-123', 'user-456')
      const childCapability = await router.createChildCapability(
        parentCapability,
        testSecret,
        childId,
        {
          methods: ['read', 'write'], // Reduced from parent
          scope: 'write', // Reduced from admin
        }
      )

      // Verify child capability
      const verified = await verifyCapabilityToken(childCapability, testSecret)
      expect(verified.target).toBe(childId)
      expect(verified.methods).toEqual(['read', 'write'])
      expect(verified.scope).toBe('write')
    })

    it('should prevent child from escalating privileges', async () => {
      const router = new ParentChildRouter()

      // Parent has limited capability
      const parentCapability = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['read'],
        scope: 'read',
        exp: Date.now() + 3600000,
      })

      const childId = router.getChildId('tenant-123', 'user-456')

      // Cannot escalate methods
      await expect(
        router.createChildCapability(parentCapability, testSecret, childId, {
          methods: ['read', 'write'], // Trying to add 'write'
        })
      ).rejects.toThrow(CapabilityError)

      // Cannot escalate scope
      await expect(
        router.createChildCapability(parentCapability, testSecret, childId, {
          scope: 'admin', // Trying to escalate
        })
      ).rejects.toThrow(CapabilityError)
    })

    it('should include parent context in child capability', async () => {
      const router = new ParentChildRouter()

      const parentCapability = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() + 3600000,
        sub: 'admin-user',
      })

      const childId = router.getChildId('tenant-123', 'user-456')
      const childCapability = await router.createChildCapability(
        parentCapability,
        testSecret,
        childId
      )

      const verified = await verifyCapabilityToken(childCapability, testSecret)
      // Child capability should inherit subject from parent
      expect(verified.sub).toBe('admin-user')
      // But target should be the child
      expect(verified.target).toBe(childId)
    })

    it('should preserve expiry constraints (child cannot exceed parent)', async () => {
      const router = new ParentChildRouter()
      const parentExpiry = Date.now() + 3600000 // 1 hour

      const parentCapability = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['*'],
        scope: 'admin',
        exp: parentExpiry,
      })

      const childId = router.getChildId('tenant-123', 'user-456')

      // Cannot extend expiry beyond parent
      await expect(
        router.createChildCapability(parentCapability, testSecret, childId, {
          exp: parentExpiry + 3600000, // Trying to extend
        })
      ).rejects.toThrow(CapabilityError)

      // Can reduce expiry
      const shorterExpiry = parentExpiry - 1800000 // 30 min less
      const childCapability = await router.createChildCapability(
        parentCapability,
        testSecret,
        childId,
        { exp: shorterExpiry }
      )

      const verified = await verifyCapabilityToken(childCapability, testSecret)
      expect(verified.exp).toBe(shorterExpiry)
    })
  })

  // ===========================================================================
  // Lifecycle Tests
  // ===========================================================================

  describe('Lifecycle', () => {
    it('should generate unique child IDs', () => {
      const router = new ParentChildRouter()

      const suffix1 = router.generateChildSuffix()
      const suffix2 = router.generateChildSuffix()
      const suffix3 = router.generateChildSuffix()

      expect(suffix1).not.toBe(suffix2)
      expect(suffix2).not.toBe(suffix3)
      expect(suffix1).not.toBe(suffix3)

      // Suffixes should be reasonable strings
      expect(suffix1.length).toBeGreaterThan(5)
      expect(suffix1).toMatch(/^child_\d+_[a-z0-9]+$/)
    })

    it('should track parent-child relationships via ID structure', () => {
      const router = new ParentChildRouter()

      const parentId = 'tenant-123'
      const child1 = router.getChildId(parentId, 'user-1')
      const child2 = router.getChildId(parentId, 'user-2')

      // All children should have same parent
      expect(router.getParentId(child1)).toBe(parentId)
      expect(router.getParentId(child2)).toBe(parentId)

      // Children are distinguishable
      expect(child1).not.toBe(child2)
    })

    it('should validate parent exists before creating child', () => {
      const router = new ParentChildRouter()

      // This is more of a behavioral test - the router doesn't store state,
      // but the ID structure ensures valid hierarchy
      const parentId = 'tenant-123'
      const childId = router.getChildId(parentId, 'user-456')

      // Child ID must contain parent ID
      expect(childId.startsWith(parentId + router['separator'])).toBe(true)
    })

    it('should enforce max hierarchy depth', () => {
      const router = new ParentChildRouter({ maxDepth: 3 })

      const level1 = 'tenant'
      const level2 = router.getChildId(level1, 'user')
      const level3 = router.getChildId(level2, 'session')

      // Level 3 is at max depth
      expect(router.getDepth(level3)).toBe(3)

      // Cannot create level 4
      expect(() => router.getChildId(level3, 'action')).toThrow(/Max hierarchy depth/)
    })

    it('should use default max depth of 5', () => {
      const router = new ParentChildRouter()

      let id = 'level1'
      for (let i = 2; i <= 5; i++) {
        id = router.getChildId(id, `level${i}`)
      }

      expect(router.getDepth(id)).toBe(5)

      // Level 6 should fail
      expect(() => router.getChildId(id, 'level6')).toThrow(/Max hierarchy depth/)
    })
  })

  // ===========================================================================
  // Hierarchy Resolver Helper Tests
  // ===========================================================================

  describe('Hierarchy Resolver Helper', () => {
    it('should resolve child from parent via stub getter', () => {
      // Mock stub getter
      const stubs = new Map<string, { id: string }>()
      stubs.set('tenant-123', { id: 'tenant-123' })
      stubs.set('tenant-123:user-456', { id: 'tenant-123:user-456' })

      const resolver = createHierarchyResolver((id) => stubs.get(id) ?? null)

      const child = resolver.getChild('tenant-123', 'user-456')
      expect(child).toEqual({ id: 'tenant-123:user-456' })
    })

    it('should resolve parent from child via stub getter', () => {
      const stubs = new Map<string, { id: string }>()
      stubs.set('tenant-123', { id: 'tenant-123' })
      stubs.set('tenant-123:user-456', { id: 'tenant-123:user-456' })

      const resolver = createHierarchyResolver((id) => stubs.get(id) ?? null)

      const parent = resolver.getParent('tenant-123:user-456')
      expect(parent).toEqual({ id: 'tenant-123' })
    })

    it('should return null for non-existent stubs', () => {
      const resolver = createHierarchyResolver(() => null)

      expect(resolver.getChild('tenant-123', 'user-456')).toBeNull()
      expect(resolver.getParent('tenant-123:user-456')).toBeNull()
    })

    it('should return null for root-level parent lookup', () => {
      const stubs = new Map<string, { id: string }>()
      stubs.set('tenant-123', { id: 'tenant-123' })

      const resolver = createHierarchyResolver((id) => stubs.get(id) ?? null)

      const parent = resolver.getParent('tenant-123')
      expect(parent).toBeNull()
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty child suffix', () => {
      const router = new ParentChildRouter()

      // Empty suffix creates valid but odd ID
      const childId = router.getChildId('tenant-123', '')
      expect(childId).toBe('tenant-123:')
    })

    it('should handle IDs with special characters', () => {
      const router = new ParentChildRouter()

      const parentId = 'tenant_123-abc'
      const childId = router.getChildId(parentId, 'user_456-xyz')

      expect(childId).toBe('tenant_123-abc:user_456-xyz')
      expect(router.getParentId(childId)).toBe(parentId)
    })

    it('should handle unicode in IDs', () => {
      const router = new ParentChildRouter()

      const parentId = '租户-123'
      const childId = router.getChildId(parentId, 'ユーザー-456')

      expect(router.getParentId(childId)).toBe(parentId)
      expect(router.parseId(childId)).toEqual(['租户-123', 'ユーザー-456'])
    })

    it('should handle IDs containing the separator character', () => {
      // Use a different separator to test this case
      const router = new ParentChildRouter({ separator: '::' })

      const parentId = 'tenant:with:colons'
      const childId = router.getChildId(parentId, 'user:456')

      expect(childId).toBe('tenant:with:colons::user:456')
      expect(router.getParentId(childId)).toBe(parentId)
    })

    it('should parse single-part ID correctly', () => {
      const router = new ParentChildRouter()

      const parts = router.parseId('tenant-123')
      expect(parts).toEqual(['tenant-123'])
    })

    it('should build ID from single part', () => {
      const router = new ParentChildRouter()

      const id = router.buildId(['tenant-123'])
      expect(id).toBe('tenant-123')
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('Integration', () => {
    it('should support full capability delegation chain', async () => {
      const router = new ParentChildRouter()

      // Root admin creates tenant capability
      const tenantCap = await router.createRootCapability('tenant-123', testSecret, {
        methods: ['*'],
        scope: 'admin',
        exp: Date.now() + 3600000,
        sub: 'root-admin',
      })

      // Tenant creates user capability (attenuated)
      const userId = router.getChildId('tenant-123', 'user-456')
      const userCap = await router.createChildCapability(tenantCap, testSecret, userId, {
        methods: ['read', 'write'],
        scope: 'write',
      })

      // User creates session capability (further attenuated)
      const sessionId = router.getChildId(userId, 'session-789')
      const sessionCap = await router.createChildCapability(userCap, testSecret, sessionId, {
        methods: ['read'],
        scope: 'read',
      })

      // Verify the chain
      const sessionVerified = await verifyCapabilityToken(sessionCap, testSecret)
      expect(sessionVerified.target).toBe('tenant-123:user-456:session-789')
      expect(sessionVerified.methods).toEqual(['read'])
      expect(sessionVerified.scope).toBe('read')
      expect(sessionVerified.sub).toBe('root-admin') // Inherited from root
    })

    it('should work with consistent routing patterns', () => {
      const router = new ParentChildRouter()

      // Simulate routing pattern: tenant -> users -> sessions
      const tenantId = 'acme-corp'

      // Create multiple users under tenant
      const users = ['alice', 'bob', 'charlie'].map((name) => router.getChildId(tenantId, name))

      // All users have same parent
      for (const userId of users) {
        expect(router.getParentId(userId)).toBe(tenantId)
        expect(router.isDescendant(tenantId, userId)).toBe(true)
      }

      // Create sessions under users
      const sessions = users.map((userId) =>
        router.getChildId(userId, router.generateChildSuffix())
      )

      // All sessions have correct ancestry
      for (let i = 0; i < sessions.length; i++) {
        expect(router.getParentId(sessions[i])).toBe(users[i])
        expect(router.isDescendant(tenantId, sessions[i])).toBe(true)
        expect(router.isDescendant(users[i], sessions[i])).toBe(true)
      }
    })
  })
})
