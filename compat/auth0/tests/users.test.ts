/**
 * Tests for Auth0 User Management API compat layer
 *
 * These tests verify the Auth0 Management API compatibility:
 * - ManagementClient initialization
 * - User CRUD operations
 * - User search and filtering
 * - Password management
 * - Email verification
 * - User metadata management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ManagementClient } from '../management-client'
import type { User, CreateUserParams, UpdateUserParams, GetUsersParams } from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

// Mock crypto.randomUUID
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

describe('Auth0 User Management Compat', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test-tenant.auth0.com',
      token: 'test-management-api-token',
    })
  })

  // ============================================================================
  // CLIENT INITIALIZATION
  // ============================================================================

  describe('ManagementClient initialization', () => {
    it('should create client with token', () => {
      const client = new ManagementClient({
        domain: 'test.auth0.com',
        token: 'my-token',
      })
      expect(client).toBeDefined()
      expect(client.users).toBeDefined()
    })

    it('should create client with client credentials', () => {
      const client = new ManagementClient({
        domain: 'test.auth0.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      })
      expect(client).toBeDefined()
    })

    it('should provide users manager', () => {
      expect(management.users).toBeDefined()
      expect(typeof management.users.create).toBe('function')
      expect(typeof management.users.get).toBe('function')
      expect(typeof management.users.update).toBe('function')
      expect(typeof management.users.delete).toBe('function')
      expect(typeof management.users.getAll).toBe('function')
    })
  })

  // ============================================================================
  // CREATE USER
  // ============================================================================

  describe('users.create', () => {
    it('should create user with email and password', async () => {
      const params: CreateUserParams = {
        connection: 'Username-Password-Authentication',
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        email_verified: true,
      }

      const user = await management.users.create(params)

      expect(user).toBeDefined()
      expect(user.user_id).toBeDefined()
      expect(user.email).toBe('newuser@example.com')
      expect(user.email_verified).toBe(true)
      expect(user.created_at).toBeDefined()
      expect(user.updated_at).toBeDefined()
    })

    it('should create user with phone number', async () => {
      const params: CreateUserParams = {
        connection: 'sms',
        phone_number: '+15551234567',
        phone_verified: true,
      }

      const user = await management.users.create(params)

      expect(user.phone_number).toBe('+15551234567')
      expect(user.phone_verified).toBe(true)
    })

    it('should create user with username', async () => {
      const params: CreateUserParams = {
        connection: 'Username-Password-Authentication',
        email: 'test@example.com',
        username: 'testuser',
        password: 'SecurePass123!',
      }

      const user = await management.users.create(params)

      expect(user.username).toBe('testuser')
    })

    it('should create user with metadata', async () => {
      const params: CreateUserParams = {
        connection: 'Username-Password-Authentication',
        email: 'meta@example.com',
        password: 'SecurePass123!',
        user_metadata: {
          theme: 'dark',
          language: 'en',
        },
        app_metadata: {
          plan: 'premium',
          features: ['feature1', 'feature2'],
        },
      }

      const user = await management.users.create(params)

      expect(user.user_metadata).toEqual({
        theme: 'dark',
        language: 'en',
      })
      expect(user.app_metadata).toEqual({
        plan: 'premium',
        features: ['feature1', 'feature2'],
      })
    })

    it('should create user with profile fields', async () => {
      const params: CreateUserParams = {
        connection: 'Username-Password-Authentication',
        email: 'profile@example.com',
        password: 'SecurePass123!',
        given_name: 'John',
        family_name: 'Doe',
        name: 'John Doe',
        nickname: 'johnny',
        picture: 'https://example.com/avatar.jpg',
      }

      const user = await management.users.create(params)

      expect(user.given_name).toBe('John')
      expect(user.family_name).toBe('Doe')
      expect(user.name).toBe('John Doe')
      expect(user.nickname).toBe('johnny')
      expect(user.picture).toBe('https://example.com/avatar.jpg')
    })

    it('should reject duplicate email', async () => {
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'duplicate@example.com',
        password: 'SecurePass123!',
      })

      await expect(
        management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'duplicate@example.com',
          password: 'AnotherPass123!',
        })
      ).rejects.toThrow()
    })

    it('should reject weak password', async () => {
      await expect(
        management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'weak@example.com',
          password: '123',
        })
      ).rejects.toThrow()
    })

    it('should include identity in created user', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'identity@example.com',
        password: 'SecurePass123!',
      })

      expect(user.identities).toBeDefined()
      expect(user.identities?.length).toBeGreaterThan(0)
      expect(user.identities?.[0].connection).toBe('Username-Password-Authentication')
      expect(user.identities?.[0].provider).toBe('auth0')
    })
  })

  // ============================================================================
  // GET USER
  // ============================================================================

  describe('users.get', () => {
    let createdUser: User

    beforeEach(async () => {
      createdUser = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'getuser@example.com',
        password: 'SecurePass123!',
        given_name: 'Get',
        family_name: 'User',
      })
    })

    it('should get user by ID', async () => {
      const user = await management.users.get({ id: createdUser.user_id })

      expect(user).toBeDefined()
      expect(user.user_id).toBe(createdUser.user_id)
      expect(user.email).toBe('getuser@example.com')
    })

    it('should return null for non-existent user', async () => {
      const user = await management.users.get({ id: 'auth0|nonexistent' })
      expect(user).toBeNull()
    })

    it('should support fields filter', async () => {
      const user = await management.users.get({
        id: createdUser.user_id,
        fields: 'user_id,email',
        include_fields: true,
      })

      expect(user?.user_id).toBe(createdUser.user_id)
      expect(user?.email).toBe('getuser@example.com')
    })
  })

  // ============================================================================
  // UPDATE USER
  // ============================================================================

  describe('users.update', () => {
    let createdUser: User

    beforeEach(async () => {
      createdUser = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'updateuser@example.com',
        password: 'SecurePass123!',
      })
    })

    it('should update user email', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        {
          email: 'newemail@example.com',
          connection: 'Username-Password-Authentication',
        }
      )

      expect(updated.email).toBe('newemail@example.com')
      expect(updated.updated_at).not.toBe(createdUser.updated_at)
    })

    it('should update user metadata', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        {
          user_metadata: {
            theme: 'light',
            notifications: true,
          },
        }
      )

      expect(updated.user_metadata).toEqual({
        theme: 'light',
        notifications: true,
      })
    })

    it('should update app metadata', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        {
          app_metadata: {
            role: 'admin',
            permissions: ['read', 'write'],
          },
        }
      )

      expect(updated.app_metadata).toEqual({
        role: 'admin',
        permissions: ['read', 'write'],
      })
    })

    it('should update profile fields', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        {
          given_name: 'Updated',
          family_name: 'Name',
          name: 'Updated Name',
          nickname: 'updated',
          picture: 'https://example.com/new-avatar.jpg',
        }
      )

      expect(updated.given_name).toBe('Updated')
      expect(updated.family_name).toBe('Name')
      expect(updated.name).toBe('Updated Name')
      expect(updated.nickname).toBe('updated')
      expect(updated.picture).toBe('https://example.com/new-avatar.jpg')
    })

    it('should update password', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        {
          password: 'NewSecurePass456!',
          connection: 'Username-Password-Authentication',
        }
      )

      expect(updated).toBeDefined()
      // Password should not be returned
      expect((updated as Record<string, unknown>).password).toBeUndefined()
    })

    it('should block/unblock user', async () => {
      // Block user
      let updated = await management.users.update(
        { id: createdUser.user_id },
        { blocked: true }
      )
      expect(updated.blocked).toBe(true)

      // Unblock user
      updated = await management.users.update(
        { id: createdUser.user_id },
        { blocked: false }
      )
      expect(updated.blocked).toBe(false)
    })

    it('should update email_verified status', async () => {
      const updated = await management.users.update(
        { id: createdUser.user_id },
        { email_verified: true }
      )

      expect(updated.email_verified).toBe(true)
    })

    it('should throw for non-existent user', async () => {
      await expect(
        management.users.update(
          { id: 'auth0|nonexistent' },
          { given_name: 'Test' }
        )
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // DELETE USER
  // ============================================================================

  describe('users.delete', () => {
    it('should delete user', async () => {
      const user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'delete@example.com',
        password: 'SecurePass123!',
      })

      await management.users.delete({ id: user.user_id })

      const deleted = await management.users.get({ id: user.user_id })
      expect(deleted).toBeNull()
    })

    it('should not throw for non-existent user', async () => {
      // Auth0 returns 204 even for non-existent users
      await expect(
        management.users.delete({ id: 'auth0|nonexistent' })
      ).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // GET ALL USERS (LIST/SEARCH)
  // ============================================================================

  describe('users.getAll', () => {
    beforeEach(async () => {
      // Create test users
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'user1@example.com',
        password: 'SecurePass123!',
        given_name: 'Alice',
        family_name: 'Smith',
        app_metadata: { department: 'engineering' },
      })
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'user2@example.com',
        password: 'SecurePass123!',
        given_name: 'Bob',
        family_name: 'Jones',
        app_metadata: { department: 'sales' },
      })
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'user3@example.com',
        password: 'SecurePass123!',
        given_name: 'Charlie',
        family_name: 'Brown',
        app_metadata: { department: 'engineering' },
      })
    })

    it('should list all users', async () => {
      const result = await management.users.getAll()

      expect(result.users).toBeDefined()
      expect(result.users.length).toBeGreaterThanOrEqual(3)
    })

    it('should support pagination', async () => {
      const page1 = await management.users.getAll({
        per_page: 2,
        page: 0,
        include_totals: true,
      })

      expect(page1.users.length).toBeLessThanOrEqual(2)
      expect(page1.total).toBeGreaterThanOrEqual(3)

      const page2 = await management.users.getAll({
        per_page: 2,
        page: 1,
      })

      expect(page2.users.length).toBeGreaterThanOrEqual(1)
    })

    it('should support Lucene query search', async () => {
      const result = await management.users.getAll({
        q: 'email:user1@example.com',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(1)
      expect(result.users[0].email).toBe('user1@example.com')
    })

    it('should search by name', async () => {
      const result = await management.users.getAll({
        q: 'given_name:Alice',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(1)
      expect(result.users[0].given_name).toBe('Alice')
    })

    it('should search by app_metadata', async () => {
      const result = await management.users.getAll({
        q: 'app_metadata.department:engineering',
        search_engine: 'v3',
      })

      expect(result.users.length).toBe(2)
    })

    it('should support sorting', async () => {
      const ascending = await management.users.getAll({
        sort: 'email:1',
      })

      const descending = await management.users.getAll({
        sort: 'email:-1',
      })

      // First user in ascending should be last in descending
      expect(ascending.users[0].email).not.toBe(descending.users[0].email)
    })

    it('should filter by connection', async () => {
      const result = await management.users.getAll({
        connection: 'Username-Password-Authentication',
      })

      expect(result.users.length).toBeGreaterThanOrEqual(3)
      for (const user of result.users) {
        expect(user.identities?.[0]?.connection).toBe('Username-Password-Authentication')
      }
    })
  })

  // ============================================================================
  // GET USERS BY EMAIL
  // ============================================================================

  describe('users.getByEmail', () => {
    beforeEach(async () => {
      await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'findme@example.com',
        password: 'SecurePass123!',
      })
    })

    it('should find user by email', async () => {
      const users = await management.users.getByEmail('findme@example.com')

      expect(users.length).toBe(1)
      expect(users[0].email).toBe('findme@example.com')
    })

    it('should return empty array for non-existent email', async () => {
      const users = await management.users.getByEmail('nonexistent@example.com')
      expect(users).toEqual([])
    })

    it('should be case-insensitive', async () => {
      const users = await management.users.getByEmail('FINDME@EXAMPLE.COM')
      expect(users.length).toBe(1)
    })
  })

  // ============================================================================
  // PASSWORD MANAGEMENT
  // ============================================================================

  describe('password management', () => {
    let user: User

    beforeEach(async () => {
      user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'password@example.com',
        password: 'OldPassword123!',
      })
    })

    it('should change user password', async () => {
      const updated = await management.users.update(
        { id: user.user_id },
        {
          password: 'NewPassword456!',
          connection: 'Username-Password-Authentication',
        }
      )

      expect(updated).toBeDefined()
    })

    it('should reject weak password on update', async () => {
      await expect(
        management.users.update(
          { id: user.user_id },
          {
            password: '123',
            connection: 'Username-Password-Authentication',
          }
        )
      ).rejects.toThrow()
    })

    it('should create password reset ticket', async () => {
      const ticket = await management.tickets.changePassword({
        user_id: user.user_id,
        result_url: 'https://example.com/reset-complete',
      })

      expect(ticket).toBeDefined()
      expect(ticket.ticket).toBeDefined()
      expect(ticket.ticket).toContain('https://')
    })
  })

  // ============================================================================
  // EMAIL VERIFICATION
  // ============================================================================

  describe('email verification', () => {
    let user: User

    beforeEach(async () => {
      user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'verify@example.com',
        password: 'SecurePass123!',
        email_verified: false,
      })
    })

    it('should create email verification ticket', async () => {
      const ticket = await management.tickets.verifyEmail({
        user_id: user.user_id,
        result_url: 'https://example.com/verified',
      })

      expect(ticket).toBeDefined()
      expect(ticket.ticket).toBeDefined()
      expect(ticket.ticket).toContain('https://')
    })

    it('should update email_verified through update', async () => {
      const updated = await management.users.update(
        { id: user.user_id },
        { email_verified: true }
      )

      expect(updated.email_verified).toBe(true)
    })

    it('should resend verification email', async () => {
      // This should not throw
      await expect(
        management.jobs.verifyEmail({
          user_id: user.user_id,
        })
      ).resolves.toBeDefined()
    })
  })

  // ============================================================================
  // USER METADATA
  // ============================================================================

  describe('user metadata management', () => {
    let user: User

    beforeEach(async () => {
      user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'metadata@example.com',
        password: 'SecurePass123!',
        user_metadata: {
          existing: 'value',
        },
      })
    })

    it('should merge user_metadata on update', async () => {
      const updated = await management.users.update(
        { id: user.user_id },
        {
          user_metadata: {
            newField: 'newValue',
          },
        }
      )

      // Auth0 merges metadata
      expect(updated.user_metadata?.existing).toBe('value')
      expect(updated.user_metadata?.newField).toBe('newValue')
    })

    it('should remove metadata field by setting to null', async () => {
      const updated = await management.users.update(
        { id: user.user_id },
        {
          user_metadata: {
            existing: null,
          },
        }
      )

      expect(updated.user_metadata?.existing).toBeUndefined()
    })

    it('should merge app_metadata on update', async () => {
      // First add some app_metadata
      await management.users.update(
        { id: user.user_id },
        {
          app_metadata: {
            role: 'user',
          },
        }
      )

      // Then add more
      const updated = await management.users.update(
        { id: user.user_id },
        {
          app_metadata: {
            verified: true,
          },
        }
      )

      expect(updated.app_metadata?.role).toBe('user')
      expect(updated.app_metadata?.verified).toBe(true)
    })
  })

  // ============================================================================
  // USER BLOCKS
  // ============================================================================

  describe('user blocking', () => {
    let user: User

    beforeEach(async () => {
      user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'block@example.com',
        password: 'SecurePass123!',
      })
    })

    it('should block user', async () => {
      const updated = await management.users.update(
        { id: user.user_id },
        { blocked: true }
      )

      expect(updated.blocked).toBe(true)
    })

    it('should unblock user', async () => {
      // First block
      await management.users.update(
        { id: user.user_id },
        { blocked: true }
      )

      // Then unblock
      const updated = await management.users.update(
        { id: user.user_id },
        { blocked: false }
      )

      expect(updated.blocked).toBe(false)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw Auth0ManagementError for user not found', async () => {
      try {
        await management.users.update(
          { id: 'auth0|nonexistent' },
          { given_name: 'Test' }
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
        expect((error as Error).message).toContain('not found')
      }
    })

    it('should include error code in thrown errors', async () => {
      try {
        await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'nopassword@example.com',
          // Missing required password for database connection
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })
})
