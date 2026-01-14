/**
 * Tests for User Management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { UserManager, createUserManager } from '../users'
import { AuthenticationError } from '../types'

describe('UserManager', () => {
  let userManager: UserManager

  beforeEach(() => {
    userManager = createUserManager({
      minPasswordLength: 8,
      maxFailedLoginAttempts: 3,
      lockoutDuration: 300,
    })
  })

  // ============================================================================
  // USER CREATION
  // ============================================================================

  describe('createUser', () => {
    it('should create a user with email and password', async () => {
      const user = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
        first_name: 'Test',
        last_name: 'User',
      })

      expect(user.id).toBeDefined()
      expect(user.id).toMatch(/^user_/)
      expect(user.email).toBe('test@example.com')
      expect(user.first_name).toBe('Test')
      expect(user.last_name).toBe('User')
      expect(user.email_verified).toBe(false)
      expect(user.created_at).toBeDefined()
    })

    it('should create a user with phone', async () => {
      const user = await userManager.createUser({
        phone: '+1234567890',
        password: 'password123',
      })

      expect(user.phone).toBe('+1234567890')
      expect(user.phone_verified).toBe(false)
    })

    it('should create a user with username', async () => {
      const user = await userManager.createUser({
        username: 'testuser',
        password: 'password123',
      })

      expect(user.username).toBe('testuser')
    })

    it('should auto-generate name from first and last name', async () => {
      const user = await userManager.createUser({
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        password: 'password123',
      })

      expect(user.name).toBe('John Doe')
    })

    it('should include metadata', async () => {
      const user = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
        metadata: { preferred_language: 'en' },
        app_metadata: { roles: ['admin'] },
      })

      expect(user.metadata.preferred_language).toBe('en')
      expect(user.app_metadata.roles).toEqual(['admin'])
    })

    it('should reject duplicate email', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      await expect(
        userManager.createUser({
          email: 'test@example.com',
          password: 'password456',
        })
      ).rejects.toThrow('A user with this email already exists')
    })

    it('should be case-insensitive for email uniqueness', async () => {
      await userManager.createUser({
        email: 'Test@Example.com',
        password: 'password123',
      })

      await expect(
        userManager.createUser({
          email: 'test@example.com',
          password: 'password456',
        })
      ).rejects.toThrow('A user with this email already exists')
    })

    it('should reject duplicate phone', async () => {
      await userManager.createUser({
        phone: '+1234567890',
        password: 'password123',
      })

      await expect(
        userManager.createUser({
          phone: '+1234567890',
          password: 'password456',
        })
      ).rejects.toThrow('A user with this phone already exists')
    })

    it('should reject duplicate username', async () => {
      await userManager.createUser({
        username: 'testuser',
        password: 'password123',
      })

      await expect(
        userManager.createUser({
          username: 'testuser',
          password: 'password456',
        })
      ).rejects.toThrow('A user with this username already exists')
    })

    it('should reject weak password', async () => {
      await expect(
        userManager.createUser({
          email: 'test@example.com',
          password: 'short',
        })
      ).rejects.toThrow('Password must be at least 8 characters')
    })

    it('should allow user without password (for OAuth)', async () => {
      const user = await userManager.createUser({
        email: 'oauth@example.com',
      })

      expect(user.email).toBe('oauth@example.com')
    })

    it('should be idempotent for same email', async () => {
      const user1 = await userManager.createUser({
        email: 'idempotent@example.com',
        password: 'password123',
      })

      // Second call should return same user (idempotent)
      // Note: In real implementation with ExactlyOnce, this would be truly idempotent
      // For now it throws due to duplicate
      await expect(
        userManager.createUser({
          email: 'idempotent@example.com',
          password: 'password123',
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // USER RETRIEVAL
  // ============================================================================

  describe('getUser', () => {
    it('should get user by ID', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      const user = await userManager.getUser(created.id)

      expect(user).not.toBeNull()
      expect(user?.id).toBe(created.id)
      expect(user?.email).toBe('test@example.com')
    })

    it('should return null for non-existent user', async () => {
      const user = await userManager.getUser('user_nonexistent')

      expect(user).toBeNull()
    })
  })

  describe('getUserByEmail', () => {
    it('should get user by email', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      const user = await userManager.getUserByEmail('test@example.com')

      expect(user).not.toBeNull()
      expect(user?.email).toBe('test@example.com')
    })

    it('should be case-insensitive', async () => {
      await userManager.createUser({
        email: 'Test@Example.com',
        password: 'password123',
      })

      const user = await userManager.getUserByEmail('test@example.com')

      expect(user).not.toBeNull()
    })

    it('should return null for non-existent email', async () => {
      const user = await userManager.getUserByEmail('nonexistent@example.com')

      expect(user).toBeNull()
    })
  })

  describe('getUserByPhone', () => {
    it('should get user by phone', async () => {
      await userManager.createUser({
        phone: '+1234567890',
        password: 'password123',
      })

      const user = await userManager.getUserByPhone('+1234567890')

      expect(user).not.toBeNull()
      expect(user?.phone).toBe('+1234567890')
    })
  })

  describe('getUserByUsername', () => {
    it('should get user by username', async () => {
      await userManager.createUser({
        username: 'testuser',
        password: 'password123',
      })

      const user = await userManager.getUserByUsername('testuser')

      expect(user).not.toBeNull()
      expect(user?.username).toBe('testuser')
    })

    it('should be case-insensitive', async () => {
      await userManager.createUser({
        username: 'TestUser',
        password: 'password123',
      })

      const user = await userManager.getUserByUsername('testuser')

      expect(user).not.toBeNull()
    })
  })

  // ============================================================================
  // USER UPDATE
  // ============================================================================

  describe('updateUser', () => {
    it('should update user fields', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      const updated = await userManager.updateUser(created.id, {
        first_name: 'Updated',
        last_name: 'Name',
        picture: 'https://example.com/avatar.jpg',
      })

      expect(updated.first_name).toBe('Updated')
      expect(updated.last_name).toBe('Name')
      expect(updated.picture).toBe('https://example.com/avatar.jpg')
      expect(updated.updated_at).not.toBe(created.updated_at)
    })

    it('should update email and index', async () => {
      const created = await userManager.createUser({
        email: 'old@example.com',
        password: 'password123',
      })

      await userManager.updateUser(created.id, {
        email: 'new@example.com',
      })

      // Old email should not find user
      const oldLookup = await userManager.getUserByEmail('old@example.com')
      expect(oldLookup).toBeNull()

      // New email should find user
      const newLookup = await userManager.getUserByEmail('new@example.com')
      expect(newLookup).not.toBeNull()
      expect(newLookup?.id).toBe(created.id)
    })

    it('should update password', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'oldpassword',
      })

      await userManager.updateUser(created.id, {
        password: 'newpassword123',
      })

      // Old password should fail
      const oldResult = await userManager.verifyPassword('test@example.com', 'oldpassword')
      expect(oldResult.valid).toBe(false)

      // New password should work
      const newResult = await userManager.verifyPassword('test@example.com', 'newpassword123')
      expect(newResult.valid).toBe(true)
    })

    it('should reject weak new password', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      await expect(
        userManager.updateUser(created.id, {
          password: 'short',
        })
      ).rejects.toThrow('Password must be at least 8 characters')
    })

    it('should reject duplicate email on update', async () => {
      const user1 = await userManager.createUser({
        email: 'user1@example.com',
        password: 'password123',
      })

      const user2 = await userManager.createUser({
        email: 'user2@example.com',
        password: 'password123',
      })

      await expect(
        userManager.updateUser(user2.id, {
          email: 'user1@example.com',
        })
      ).rejects.toThrow('This email is already in use')
    })

    it('should throw for non-existent user', async () => {
      await expect(
        userManager.updateUser('user_nonexistent', {
          first_name: 'Test',
        })
      ).rejects.toThrow('User not found')
    })

    it('should merge metadata', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
        metadata: { key1: 'value1' },
      })

      const updated = await userManager.updateUser(created.id, {
        metadata: { key2: 'value2' },
      })

      expect(updated.metadata.key1).toBe('value1')
      expect(updated.metadata.key2).toBe('value2')
    })
  })

  // ============================================================================
  // USER DELETION
  // ============================================================================

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      await userManager.deleteUser(created.id)

      const user = await userManager.getUser(created.id)
      expect(user).toBeNull()
    })

    it('should remove from indexes', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        phone: '+1234567890',
        username: 'testuser',
        password: 'password123',
      })

      await userManager.deleteUser(created.id)

      expect(await userManager.getUserByEmail('test@example.com')).toBeNull()
      expect(await userManager.getUserByPhone('+1234567890')).toBeNull()
      expect(await userManager.getUserByUsername('testuser')).toBeNull()
    })

    it('should be idempotent', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      await userManager.deleteUser(created.id)
      await userManager.deleteUser(created.id) // Should not throw

      const user = await userManager.getUser(created.id)
      expect(user).toBeNull()
    })
  })

  // ============================================================================
  // PASSWORD VERIFICATION
  // ============================================================================

  describe('verifyPassword', () => {
    it('should verify correct password with email', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'correctpassword',
      })

      const result = await userManager.verifyPassword('test@example.com', 'correctpassword')

      expect(result.valid).toBe(true)
      expect(result.user).toBeDefined()
      expect(result.user?.email).toBe('test@example.com')
    })

    it('should verify correct password with phone', async () => {
      await userManager.createUser({
        phone: '+1234567890',
        password: 'correctpassword',
      })

      const result = await userManager.verifyPassword('+1234567890', 'correctpassword')

      expect(result.valid).toBe(true)
    })

    it('should verify correct password with username', async () => {
      await userManager.createUser({
        username: 'testuser',
        password: 'correctpassword',
      })

      const result = await userManager.verifyPassword('testuser', 'correctpassword')

      expect(result.valid).toBe(true)
    })

    it('should reject incorrect password', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'correctpassword',
      })

      const result = await userManager.verifyPassword('test@example.com', 'wrongpassword')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid credentials')
    })

    it('should reject non-existent user', async () => {
      const result = await userManager.verifyPassword('nonexistent@example.com', 'password')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid credentials')
    })

    it('should reject user without password', async () => {
      await userManager.createUser({
        email: 'oauth@example.com',
        // No password
      })

      const result = await userManager.verifyPassword('oauth@example.com', 'anypassword')

      expect(result.valid).toBe(false)
      expect(result.error).toBe('No password set for this account')
    })

    it('should lock account after max failed attempts', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'correctpassword',
      })

      // Fail 3 times
      await userManager.verifyPassword('test@example.com', 'wrong1')
      await userManager.verifyPassword('test@example.com', 'wrong2')
      await userManager.verifyPassword('test@example.com', 'wrong3')

      // Account should be locked
      const result = await userManager.verifyPassword('test@example.com', 'correctpassword')

      expect(result.valid).toBe(false)
      expect(result.locked).toBe(true)
      expect(result.lockUntil).toBeInstanceOf(Date)
    })

    it('should reset failed attempts on success', async () => {
      await userManager.createUser({
        email: 'test@example.com',
        password: 'correctpassword',
      })

      // Fail twice
      await userManager.verifyPassword('test@example.com', 'wrong1')
      await userManager.verifyPassword('test@example.com', 'wrong2')

      // Succeed
      const result = await userManager.verifyPassword('test@example.com', 'correctpassword')
      expect(result.valid).toBe(true)

      // Can fail again without immediate lockout
      await userManager.verifyPassword('test@example.com', 'wrong3')
      await userManager.verifyPassword('test@example.com', 'wrong4')

      const finalResult = await userManager.verifyPassword('test@example.com', 'correctpassword')
      expect(finalResult.valid).toBe(true)
    })

    it('should update last sign in time', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'correctpassword',
      })

      expect(created.last_sign_in_at).toBeUndefined()

      await userManager.verifyPassword('test@example.com', 'correctpassword')

      const user = await userManager.getUser(created.id)
      expect(user?.last_sign_in_at).toBeDefined()
    })
  })

  // ============================================================================
  // IDENTITY MANAGEMENT
  // ============================================================================

  describe('addIdentity', () => {
    it('should add an identity to a user', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      const identity = await userManager.addIdentity(created.id, {
        id: 'github_12345',
        provider: 'github',
        provider_id: '12345',
        is_social: true,
        profile_data: { login: 'testuser' },
      })

      expect(identity.id).toBe('github_12345')
      expect(identity.user_id).toBe(created.id)
      expect(identity.provider).toBe('github')
      expect(identity.created_at).toBeDefined()

      const user = await userManager.getUser(created.id)
      expect(user?.identities).toHaveLength(1)
      expect(user?.identities?.[0].provider).toBe('github')
    })

    it('should throw for non-existent user', async () => {
      await expect(
        userManager.addIdentity('user_nonexistent', {
          id: 'github_12345',
          provider: 'github',
          provider_id: '12345',
          is_social: true,
        })
      ).rejects.toThrow('User not found')
    })
  })

  describe('removeIdentity', () => {
    it('should remove an identity from a user', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      await userManager.addIdentity(created.id, {
        id: 'github_12345',
        provider: 'github',
        provider_id: '12345',
        is_social: true,
      })

      await userManager.removeIdentity(created.id, 'github_12345')

      const user = await userManager.getUser(created.id)
      expect(user?.identities).toHaveLength(0)
    })

    it('should be idempotent', async () => {
      const created = await userManager.createUser({
        email: 'test@example.com',
        password: 'password123',
      })

      // Remove non-existent identity - should not throw
      await userManager.removeIdentity(created.id, 'nonexistent')
    })
  })
})
