/**
 * Tests for Auth0 Roles and Permissions
 *
 * These tests verify:
 * - Role assignment and removal
 * - Permission assignment and removal
 * - User blocking/unblocking
 * - App metadata-based authorization
 * - Role-based access control patterns
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ManagementClient } from '../management-client'
import type { User } from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
  },
})

describe('Roles and Permissions', () => {
  let management: ManagementClient
  let testUser: User

  beforeEach(async () => {
    management = new ManagementClient({
      domain: 'test.auth0.com',
      token: 'test-token',
    })

    // Create a test user for each test
    testUser = await management.users.create({
      connection: 'Username-Password-Authentication',
      email: 'roles-test@example.com',
      password: 'SecurePass123!',
    })
  })

  // ============================================================================
  // ROLE ASSIGNMENT VIA APP METADATA
  // ============================================================================

  describe('role assignment via app_metadata', () => {
    it('should assign roles via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: ['user', 'admin'],
          },
        }
      )

      expect(updated.app_metadata?.roles).toEqual(['user', 'admin'])
    })

    it('should update existing roles', async () => {
      // Set initial roles
      await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: ['user'],
          },
        }
      )

      // Add admin role
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: ['user', 'admin', 'moderator'],
          },
        }
      )

      expect(updated.app_metadata?.roles).toEqual(['user', 'admin', 'moderator'])
    })

    it('should remove roles by setting to empty array', async () => {
      // Set roles first
      await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: ['admin'],
          },
        }
      )

      // Remove all roles
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: [],
          },
        }
      )

      expect(updated.app_metadata?.roles).toEqual([])
    })

    it('should remove roles by setting to null', async () => {
      // Set roles first
      await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: ['admin'],
          },
        }
      )

      // Remove roles field entirely
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            roles: null,
          },
        }
      )

      expect(updated.app_metadata?.roles).toBeUndefined()
    })
  })

  // ============================================================================
  // PERMISSION ASSIGNMENT VIA APP METADATA
  // ============================================================================

  describe('permission assignment via app_metadata', () => {
    it('should assign permissions via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            permissions: [
              { resource: 'api', action: 'read' },
              { resource: 'api', action: 'write' },
            ],
          },
        }
      )

      expect(updated.app_metadata?.permissions).toHaveLength(2)
    })

    it('should support granular permission patterns', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            permissions: {
              'users:read': true,
              'users:write': true,
              'users:delete': false,
              'admin:access': true,
            },
          },
        }
      )

      const permissions = updated.app_metadata?.permissions as Record<string, boolean>
      expect(permissions['users:read']).toBe(true)
      expect(permissions['users:delete']).toBe(false)
    })

    it('should support scope-based permissions', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            scopes: ['read:users', 'write:users', 'read:orders'],
          },
        }
      )

      expect(updated.app_metadata?.scopes).toEqual([
        'read:users',
        'write:users',
        'read:orders',
      ])
    })
  })

  // ============================================================================
  // USER BLOCKING
  // ============================================================================

  describe('user blocking', () => {
    it('should block a user', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        { blocked: true }
      )

      expect(updated.blocked).toBe(true)
    })

    it('should unblock a user', async () => {
      // Block first
      await management.users.update(
        { id: testUser.user_id },
        { blocked: true }
      )

      // Unblock
      const updated = await management.users.update(
        { id: testUser.user_id },
        { blocked: false }
      )

      expect(updated.blocked).toBe(false)
    })

    it('should list blocked users', async () => {
      // Block the user
      await management.users.update(
        { id: testUser.user_id },
        { blocked: true }
      )

      // Create a non-blocked user
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'notblocked@example.com',
        password: 'SecurePass123!',
      })

      // Search for blocked users
      const result = await management.users.getAll({
        q: 'blocked:true',
        search_engine: 'v3',
      })

      expect(result.users.length).toBeGreaterThanOrEqual(1)
      expect(result.users.every((u) => u.blocked === true)).toBe(true)
    })
  })

  // ============================================================================
  // EMAIL VERIFICATION STATUS
  // ============================================================================

  describe('email verification', () => {
    it('should mark email as verified', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        { email_verified: true }
      )

      expect(updated.email_verified).toBe(true)
    })

    it('should mark email as unverified', async () => {
      // First verify
      await management.users.update(
        { id: testUser.user_id },
        { email_verified: true }
      )

      // Then unverify
      const updated = await management.users.update(
        { id: testUser.user_id },
        { email_verified: false }
      )

      expect(updated.email_verified).toBe(false)
    })

    it('should create user with verified email', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'preverified@example.com',
        password: 'SecurePass123!',
        email_verified: true,
      })

      expect(user.email_verified).toBe(true)
    })
  })

  // ============================================================================
  // AUTHORIZATION PATTERNS
  // ============================================================================

  describe('authorization patterns', () => {
    it('should support tenant isolation via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            tenant_id: 'tenant_123',
            organization_id: 'org_456',
          },
        }
      )

      expect(updated.app_metadata?.tenant_id).toBe('tenant_123')
      expect(updated.app_metadata?.organization_id).toBe('org_456')
    })

    it('should support feature flags via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            features: {
              beta_access: true,
              advanced_analytics: false,
              ai_assistant: true,
            },
          },
        }
      )

      const features = updated.app_metadata?.features as Record<string, boolean>
      expect(features.beta_access).toBe(true)
      expect(features.advanced_analytics).toBe(false)
    })

    it('should support subscription tier via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            subscription: {
              plan: 'enterprise',
              status: 'active',
              expires_at: '2025-12-31T23:59:59Z',
              seats: 100,
            },
          },
        }
      )

      const subscription = updated.app_metadata?.subscription as Record<string, unknown>
      expect(subscription.plan).toBe('enterprise')
      expect(subscription.status).toBe('active')
    })

    it('should support API rate limits via app_metadata', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: {
            rate_limits: {
              requests_per_minute: 1000,
              requests_per_day: 100000,
            },
          },
        }
      )

      const limits = updated.app_metadata?.rate_limits as Record<string, number>
      expect(limits.requests_per_minute).toBe(1000)
    })
  })

  // ============================================================================
  // USER METADATA FOR PREFERENCES
  // ============================================================================

  describe('user preferences via user_metadata', () => {
    it('should store user preferences', async () => {
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          user_metadata: {
            theme: 'dark',
            language: 'en',
            timezone: 'America/New_York',
            notifications: {
              email: true,
              push: false,
              sms: false,
            },
          },
        }
      )

      expect(updated.user_metadata?.theme).toBe('dark')
      expect(updated.user_metadata?.language).toBe('en')
    })

    it('should allow users to update their own preferences', async () => {
      // First set
      await management.users.update(
        { id: testUser.user_id },
        {
          user_metadata: {
            theme: 'light',
          },
        }
      )

      // Update
      const updated = await management.users.update(
        { id: testUser.user_id },
        {
          user_metadata: {
            theme: 'dark',
          },
        }
      )

      expect(updated.user_metadata?.theme).toBe('dark')
    })
  })

  // ============================================================================
  // SEARCH BY ROLES/PERMISSIONS
  // ============================================================================

  describe('search by roles and permissions', () => {
    beforeEach(async () => {
      // Create users with different roles
      const admin = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'admin@example.com',
        password: 'SecurePass123!',
        app_metadata: { roles: ['admin'] },
      })

      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'moderator@example.com',
        password: 'SecurePass123!',
        app_metadata: { roles: ['moderator'] },
      })

      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'normaluser@example.com',
        password: 'SecurePass123!',
        app_metadata: { roles: ['user'] },
      })
    })

    it('should search users by role in app_metadata', async () => {
      const result = await management.users.getAll({
        q: 'app_metadata.roles:admin',
        search_engine: 'v3',
      })

      expect(result.users.some((u) => u.email === 'admin@example.com')).toBe(true)
    })

    it('should search users by tenant', async () => {
      // First assign a tenant
      await management.users.update(
        { id: testUser.user_id },
        {
          app_metadata: { tenant: 'acme' },
        }
      )

      const result = await management.users.getAll({
        q: 'app_metadata.tenant:acme',
        search_engine: 'v3',
      })

      expect(result.users.some((u) => u.user_id === testUser.user_id)).toBe(true)
    })
  })

  // ============================================================================
  // IDENTITY MANAGEMENT
  // ============================================================================

  describe('identity information', () => {
    it('should include identity in user record', async () => {
      const user = await management.users.get({ id: testUser.user_id })

      expect(user?.identities).toBeDefined()
      expect(user?.identities?.length).toBeGreaterThan(0)
      expect(user?.identities?.[0].connection).toBe('Username-Password-Authentication')
      expect(user?.identities?.[0].provider).toBe('auth0')
      expect(user?.identities?.[0].isSocial).toBe(false)
    })

    it('should include identity provider info', async () => {
      const user = await management.users.get({ id: testUser.user_id })

      expect(user?.identities?.[0].user_id).toBeDefined()
    })
  })
})
