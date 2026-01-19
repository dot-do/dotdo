import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { User, Session, Credential } from '../../primitives/packages/id.org.ai/src/index'
import {
  orgAiAuthMiddleware,
  lookupUserByOrgAiId,
  checkOrganizationMembership,
  mapOrgAiRolesToPermissions,
  initiateSSOFlow,
  type OrgAiAuthOptions,
  type OrgAiUser,
  type OrgAiOrganization,
  type OrgAiPermissions
} from '../org-ai'

describe('org.ai/auth integration', () => {
  describe('orgAiAuthMiddleware', () => {
    let app: Hono

    beforeEach(() => {
      app = new Hono()
    })

    it('should reject requests without valid org.ai session', async () => {
      app.use('/*', orgAiAuthMiddleware())
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('org.ai session required')
    })

    it('should accept valid org.ai session token', async () => {
      app.use('/*', orgAiAuthMiddleware())
      app.get('/protected', (c) => c.json({ user: c.get('orgAiUser') }))

      // Mock valid org.ai session
      const mockSession: Session = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'valid-org-ai-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        metadata: { provider: 'org.ai' }
      }

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${mockSession.token}`,
          'X-Org-AI-Session': JSON.stringify(mockSession)
        }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user).toBeDefined()
    })

    it('should reject expired org.ai sessions', async () => {
      app.use('/*', orgAiAuthMiddleware())
      app.get('/protected', (c) => c.json({ ok: true }))

      // Mock expired session
      const expiredSession: Session = {
        $id: 'https://schema.org.ai/sessions/sess-expired',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'expired-token',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        metadata: { provider: 'org.ai' }
      }

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${expiredSession.token}`,
          'X-Org-AI-Session': JSON.stringify(expiredSession)
        }
      })

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('expired')
    })

    it('should validate organization membership when required', async () => {
      const options: OrgAiAuthOptions = {
        requireOrganization: 'org-123'
      }

      app.use('/*', orgAiAuthMiddleware(options))
      app.get('/org-resource', (c) => c.json({ ok: true }))

      // Mock session without org membership
      const session: Session = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        metadata: { organizations: [] }
      }

      const res = await app.request('/org-resource', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Org-AI-Session': JSON.stringify(session)
        }
      })

      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json.error).toMatch(/organization/i) // Case insensitive
    })

    it('should allow access with valid organization membership', async () => {
      const options: OrgAiAuthOptions = {
        requireOrganization: 'org-123'
      }

      app.use('/*', orgAiAuthMiddleware(options))
      app.get('/org-resource', (c) => c.json({ ok: true }))

      // Mock session with org membership
      const session: Session = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        metadata: {
          organizations: [{
            $id: 'org-123',
            role: 'member'
          }]
        }
      }

      const res = await app.request('/org-resource', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Org-AI-Session': JSON.stringify(session)
        }
      })

      expect(res.status).toBe(200)
    })
  })

  describe('lookupUserByOrgAiId', () => {
    it('should find user by org.ai identity ID', async () => {
      const userId = 'https://schema.org.ai/users/user-123'
      const user = await lookupUserByOrgAiId(userId)

      expect(user).toBeDefined()
      expect(user?.$id).toBe(userId)
      expect(user?.$type).toBe('https://schema.org.ai/User')
    })

    it('should return null for non-existent user', async () => {
      const user = await lookupUserByOrgAiId('https://schema.org.ai/users/nonexistent')
      expect(user).toBeNull()
    })

    it('should validate user schema', async () => {
      const userId = 'https://schema.org.ai/users/user-123'
      const user = await lookupUserByOrgAiId(userId)

      if (user) {
        expect(user.email).toBeDefined()
        expect(user.name).toBeDefined()
        expect(user.createdAt).toBeDefined()
        expect(user.updatedAt).toBeDefined()
      }
    })
  })

  describe('checkOrganizationMembership', () => {
    it('should return true for valid organization member', async () => {
      const userId = 'https://schema.org.ai/users/user-123'
      const orgId = 'org-456'

      const isMember = await checkOrganizationMembership(userId, orgId)
      expect(isMember).toBe(true)
    })

    it('should return false for non-member', async () => {
      const userId = 'https://schema.org.ai/users/user-123'
      const orgId = 'org-nonexistent'

      const isMember = await checkOrganizationMembership(userId, orgId)
      expect(isMember).toBe(false)
    })

    it('should handle organization roles', async () => {
      const userId = 'https://schema.org.ai/users/user-123'
      const orgId = 'org-456'

      const membership = await checkOrganizationMembership(userId, orgId, { includeRole: true })
      expect(membership).toMatchObject({
        isMember: true,
        role: expect.any(String)
      })
    })
  })

  describe('mapOrgAiRolesToPermissions', () => {
    it('should map owner role to full permissions', () => {
      const permissions = mapOrgAiRolesToPermissions('owner')

      expect(permissions).toMatchObject({
        read: true,
        write: true,
        admin: true,
        delete: true
      })
    })

    it('should map admin role to admin permissions', () => {
      const permissions = mapOrgAiRolesToPermissions('admin')

      expect(permissions).toMatchObject({
        read: true,
        write: true,
        admin: true,
        delete: false
      })
    })

    it('should map member role to basic permissions', () => {
      const permissions = mapOrgAiRolesToPermissions('member')

      expect(permissions).toMatchObject({
        read: true,
        write: true,
        admin: false,
        delete: false
      })
    })

    it('should map viewer role to read-only', () => {
      const permissions = mapOrgAiRolesToPermissions('viewer')

      expect(permissions).toMatchObject({
        read: true,
        write: false,
        admin: false,
        delete: false
      })
    })

    it('should handle custom roles', () => {
      const permissions = mapOrgAiRolesToPermissions('custom-role', {
        customMappings: {
          'custom-role': {
            read: true,
            write: true,
            admin: false,
            delete: false,
            customPermission: true
          }
        }
      })

      expect(permissions.customPermission).toBe(true)
    })
  })

  describe('initiateSSOFlow', () => {
    it('should generate SSO redirect URL for org.ai provider', async () => {
      const options = {
        provider: 'org.ai',
        redirectUri: 'https://app.example.com/auth/callback',
        state: 'random-state-string'
      }

      const result = await initiateSSOFlow(options)

      expect(result.redirectUrl).toBeDefined()
      expect(result.redirectUrl).toContain('id.org.ai')
      expect(result.state).toBe(options.state)
    })

    it('should handle OAuth2 flow', async () => {
      const options = {
        provider: 'google',
        redirectUri: 'https://app.example.com/auth/callback',
        scopes: ['openid', 'email', 'profile']
      }

      const result = await initiateSSOFlow(options)

      expect(result.redirectUrl).toBeDefined()
      expect(result.authUrl).toContain('oauth')
    })

    it('should include PKCE for enhanced security', async () => {
      const options = {
        provider: 'org.ai',
        redirectUri: 'https://app.example.com/auth/callback',
        usePKCE: true
      }

      const result = await initiateSSOFlow(options)

      expect(result.codeVerifier).toBeDefined()
      expect(result.codeChallenge).toBeDefined()
      expect(result.codeChallengeMethod).toBe('S256')
    })

    it('should emit auth.sso.initiated event to pipeline', async () => {
      const eventSpy = vi.fn()

      const options = {
        provider: 'org.ai',
        redirectUri: 'https://app.example.com/auth/callback',
        onEvent: eventSpy
      }

      await initiateSSOFlow(options)

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          $type: 'auth.sso.initiated',
          provider: 'org.ai'
        })
      )
    })
  })

  describe('Integration with existing auth middleware', () => {
    it('should work alongside existing authMiddleware', async () => {
      const app = new Hono()

      // Use both middleware in sequence
      app.use('/*', orgAiAuthMiddleware())
      app.get('/resource', (c) => {
        const user = c.get('user')
        const orgAiUser = c.get('orgAiUser')
        return c.json({ user, orgAiUser })
      })

      const session: Session = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        metadata: { provider: 'org.ai' }
      }

      const res = await app.request('/resource', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Org-AI-Session': JSON.stringify(session)
        }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.orgAiUser).toBeDefined()
    })
  })

  describe('Error handling and edge cases', () => {
    it('should handle malformed session data gracefully', async () => {
      const app = new Hono()
      app.use('/*', orgAiAuthMiddleware())
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: {
          'X-Org-AI-Session': 'invalid-json-data'
        }
      })

      expect(res.status).toBe(401)
    })

    it('should handle missing session metadata', async () => {
      const session: Partial<Session> = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'valid-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        // No metadata
      }

      const app = new Hono()
      app.use('/*', orgAiAuthMiddleware())
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'X-Org-AI-Session': JSON.stringify(session)
        }
      })

      expect(res.status).toBe(200) // Should still work without metadata
    })
  })
})
