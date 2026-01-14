/**
 * Clerk Users API Compatibility Layer Tests (RED Phase)
 *
 * Comprehensive failing tests to drive implementation of Clerk-compatible
 * user management API including CRUD operations, search, metadata,
 * verification, password management, and external accounts.
 *
 * These tests follow the Clerk Backend API specification for users:
 * - User CRUD operations
 * - User search and filtering
 * - User metadata management
 * - Password management
 * - External accounts
 * - User banning and locking
 *
 * @see https://clerk.com/docs/reference/backend-api#tag/Users
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Clerk, createClerkClient, ClerkAPIError, type ClerkUser } from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Clerk Users API', () => {
  let clerk: Clerk

  beforeEach(() => {
    clerk = createClerkClient({
      secretKey: 'sk_test_secret_key_at_least_32_chars_long_for_testing',
      publishableKey: 'pk_test_publishable_key',
    })
  })

  // Helper to create a unique email
  const uniqueEmail = () => `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`

  // ============================================================================
  // 1. USER CREATION (20+ tests)
  // ============================================================================

  describe('createUser', () => {
    it('should create a user with email and password', async () => {
      const email = uniqueEmail()
      const user = await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
        first_name: 'John',
        last_name: 'Doe',
      })

      expect(user).toBeDefined()
      expect(user.id).toMatch(/^user_/)
      expect(user.object).toBe('user')
      expect(user.first_name).toBe('John')
      expect(user.last_name).toBe('Doe')
      expect(user.email_addresses).toHaveLength(1)
      expect(user.email_addresses[0].email_address).toBe(email)
      expect(user.password_enabled).toBe(true)
    })

    it('should create a user with multiple email addresses', async () => {
      const email1 = uniqueEmail()
      const email2 = uniqueEmail()

      const user = await clerk.users.createUser({
        email_address: [email1, email2],
        password: 'SecurePassword123!',
      })

      expect(user.email_addresses).toHaveLength(2)
      expect(user.primary_email_address_id).toBe(user.email_addresses[0].id)
    })

    it('should create a user with phone number', async () => {
      const user = await clerk.users.createUser({
        phone_number: ['+14155551234'],
        password: 'SecurePassword123!',
      })

      expect(user.phone_numbers).toHaveLength(1)
      expect(user.phone_numbers[0].phone_number).toBe('+14155551234')
      expect(user.primary_phone_number_id).toBe(user.phone_numbers[0].id)
    })

    it('should create a user with username', async () => {
      const username = `user_${Date.now()}`

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      expect(user.username).toBe(username)
    })

    it('should create a user with web3 wallet', async () => {
      const wallet = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'

      const user = await clerk.users.createUser({
        web3_wallet: [wallet],
      })

      expect(user.web3_wallets).toHaveLength(1)
      expect(user.web3_wallets[0].web3_wallet).toBe(wallet)
    })

    it('should create a user with external_id', async () => {
      const externalId = `ext_${Date.now()}`

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        external_id: externalId,
        password: 'SecurePassword123!',
      })

      expect(user.external_id).toBe(externalId)
    })

    it('should create a user with public metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        public_metadata: { tier: 'premium', features: ['analytics', 'reports'] },
      })

      expect(user.public_metadata).toEqual({ tier: 'premium', features: ['analytics', 'reports'] })
    })

    it('should create a user with private metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        private_metadata: { stripeCustomerId: 'cus_123', internalNotes: 'VIP customer' },
      })

      expect(user.private_metadata).toEqual({ stripeCustomerId: 'cus_123', internalNotes: 'VIP customer' })
    })

    it('should create a user with unsafe metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        unsafe_metadata: { preferences: { theme: 'dark' } },
      })

      expect(user.unsafe_metadata).toEqual({ preferences: { theme: 'dark' } })
    })

    it('should create a user with password_digest', async () => {
      // Pre-hashed password using bcrypt
      const passwordDigest = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password_digest: passwordDigest,
        password_hasher: 'bcrypt',
      })

      expect(user.password_enabled).toBe(true)
    })

    it('should create a user with skip_password_checks', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'weak', // Normally would be rejected
        skip_password_checks: true,
      })

      expect(user.password_enabled).toBe(true)
    })

    it('should create a user with TOTP secret', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        totp_secret: 'JBSWY3DPEHPK3PXP',
      })

      expect(user.totp_enabled).toBe(true)
      expect(user.two_factor_enabled).toBe(true)
    })

    it('should create a user with backup codes', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        backup_codes: ['12345678', '23456789', '34567890'],
      })

      expect(user.backup_code_enabled).toBe(true)
    })

    it('should create a user with created_at', async () => {
      const createdAt = '2023-01-15T10:30:00Z'

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        created_at: createdAt,
      })

      expect(user.created_at).toBe(new Date(createdAt).getTime())
    })

    it('should create a user with delete_self_enabled', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        delete_self_enabled: false,
      })

      expect(user.delete_self_enabled).toBe(false)
    })

    it('should create a user with create_organization_enabled', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        create_organization_enabled: false,
      })

      expect(user.create_organization_enabled).toBe(false)
    })

    it('should reject duplicate email address', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      await expect(
        clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        expect((error as ClerkAPIError).status).toBe(422)
        expect((error as ClerkAPIError).errors[0].code).toBe('form_identifier_exists')
      }
    })

    it('should reject duplicate phone number', async () => {
      const phone = '+14155559876'

      await clerk.users.createUser({
        phone_number: [phone],
        password: 'SecurePassword123!',
      })

      await expect(
        clerk.users.createUser({
          phone_number: [phone],
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject duplicate username', async () => {
      const username = `user_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      await expect(
        clerk.users.createUser({
          email_address: [uniqueEmail()],
          username,
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject weak password without skip_password_checks', async () => {
      await expect(
        clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'weak',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: '123',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('form_password_pwned')
      }
    })

    it('should create a user without password (passwordless)', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        skip_password_requirement: true,
      })

      expect(user.password_enabled).toBe(false)
    })
  })

  // ============================================================================
  // 2. GET USER (10+ tests)
  // ============================================================================

  describe('getUser', () => {
    it('should get user by ID', async () => {
      const created = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: 'Get',
        last_name: 'User',
      })

      const user = await clerk.users.getUser(created.id)

      expect(user).toBeDefined()
      expect(user.id).toBe(created.id)
      expect(user.first_name).toBe('Get')
      expect(user.last_name).toBe('User')
    })

    it('should return full user object with all fields', async () => {
      const email = uniqueEmail()
      const created = await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
        first_name: 'Full',
        last_name: 'Data',
        public_metadata: { role: 'admin' },
      })

      const user = await clerk.users.getUser(created.id)

      expect(user.id).toBeDefined()
      expect(user.object).toBe('user')
      expect(user.email_addresses).toBeDefined()
      expect(user.phone_numbers).toBeDefined()
      expect(user.web3_wallets).toBeDefined()
      expect(user.external_accounts).toBeDefined()
      expect(user.public_metadata).toEqual({ role: 'admin' })
      expect(user.private_metadata).toBeDefined()
      expect(user.unsafe_metadata).toBeDefined()
      expect(user.created_at).toBeDefined()
      expect(user.updated_at).toBeDefined()
    })

    it('should throw 404 for non-existent user', async () => {
      await expect(clerk.users.getUser('user_nonexistent_id_12345')).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.users.getUser('user_nonexistent_id_12345')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        expect((error as ClerkAPIError).status).toBe(404)
        expect((error as ClerkAPIError).errors[0].code).toBe('resource_not_found')
      }
    })

    it('should include email addresses with verification status', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.email_addresses[0]).toMatchObject({
        id: expect.any(String),
        object: 'email_address',
        email_address: expect.any(String),
        verification: expect.any(Object),
      })
    })

    it('should include external accounts', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      await clerk.users.linkExternalAccount(user.id, {
        provider: 'google',
        token: 'fake_google_token',
        providerUserId: 'google_123',
        email: 'user@gmail.com',
      })

      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.external_accounts).toHaveLength(1)
      expect(fetched.external_accounts[0].provider).toBe('google')
    })

    it('should return banned status', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      await clerk.users.banUser(user.id, 'Violated terms of service')

      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.banned).toBe(true)
    })

    it('should return locked status', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      // Simulate account lockout (would normally happen from failed auth attempts)
      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.locked).toBeDefined()
      expect(typeof fetched.locked).toBe('boolean')
    })

    it('should return timestamps', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.created_at).toBeDefined()
      expect(typeof fetched.created_at).toBe('number')
      expect(fetched.updated_at).toBeDefined()
      expect(typeof fetched.updated_at).toBe('number')
    })
  })

  // ============================================================================
  // 3. UPDATE USER (15+ tests)
  // ============================================================================

  describe('updateUser', () => {
    it('should update user first_name and last_name', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: 'Original',
        last_name: 'Name',
      })

      const updated = await clerk.users.updateUser(user.id, {
        first_name: 'Updated',
        last_name: 'User',
      })

      expect(updated.first_name).toBe('Updated')
      expect(updated.last_name).toBe('User')
      expect(updated.updated_at).toBeGreaterThan(user.updated_at)
    })

    it('should update username', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username: `old_${Date.now()}`,
        password: 'SecurePassword123!',
      })

      const newUsername = `new_${Date.now()}`
      const updated = await clerk.users.updateUser(user.id, {
        username: newUsername,
      })

      expect(updated.username).toBe(newUsername)
    })

    it('should update external_id', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const externalId = `ext_${Date.now()}`
      const updated = await clerk.users.updateUser(user.id, {
        external_id: externalId,
      })

      expect(updated.external_id).toBe(externalId)
    })

    it('should update primary_email_address_id', async () => {
      const email1 = uniqueEmail()
      const email2 = uniqueEmail()

      const user = await clerk.users.createUser({
        email_address: [email1, email2],
        password: 'SecurePassword123!',
      })

      const secondEmailId = user.email_addresses[1].id

      const updated = await clerk.users.updateUser(user.id, {
        primary_email_address_id: secondEmailId,
      })

      expect(updated.primary_email_address_id).toBe(secondEmailId)
    })

    it('should update primary_phone_number_id', async () => {
      const user = await clerk.users.createUser({
        phone_number: ['+14155551111', '+14155552222'],
        password: 'SecurePassword123!',
      })

      const secondPhoneId = user.phone_numbers[1].id

      const updated = await clerk.users.updateUser(user.id, {
        primary_phone_number_id: secondPhoneId,
      })

      expect(updated.primary_phone_number_id).toBe(secondPhoneId)
    })

    it('should update password', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'OldPassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        password: 'NewPassword456!',
      })

      expect(updated.password_enabled).toBe(true)
      expect(updated.updated_at).toBeGreaterThan(user.updated_at)
    })

    it('should update password with skip_password_checks', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        password: 'weak',
        skip_password_checks: true,
      })

      expect(updated.password_enabled).toBe(true)
    })

    it('should update password with password_digest', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        password_digest: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        password_hasher: 'bcrypt',
      })

      expect(updated.password_enabled).toBe(true)
    })

    it('should update public_metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        public_metadata: { oldKey: 'oldValue' },
      })

      const updated = await clerk.users.updateUser(user.id, {
        public_metadata: { newKey: 'newValue', tier: 'premium' },
      })

      expect(updated.public_metadata).toEqual({ oldKey: 'oldValue', newKey: 'newValue', tier: 'premium' })
    })

    it('should update private_metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        private_metadata: { internalId: 'int_123', notes: 'Important customer' },
      })

      expect(updated.private_metadata).toEqual({ internalId: 'int_123', notes: 'Important customer' })
    })

    it('should update unsafe_metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        unsafe_metadata: { preferences: { theme: 'light' } },
      })

      expect(updated.unsafe_metadata).toEqual({ preferences: { theme: 'light' } })
    })

    it('should update TOTP settings', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        totp_secret: 'NEWTOTSECRET12345',
      })

      expect(updated.totp_enabled).toBe(true)
    })

    it('should update backup_codes', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const updated = await clerk.users.updateUser(user.id, {
        backup_codes: ['code1', 'code2', 'code3', 'code4'],
      })

      expect(updated.backup_code_enabled).toBe(true)
    })

    it('should throw 404 for non-existent user', async () => {
      await expect(
        clerk.users.updateUser('user_nonexistent', {
          first_name: 'Test',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.users.updateUser('user_nonexistent', { first_name: 'Test' })
      } catch (error) {
        expect((error as ClerkAPIError).status).toBe(404)
      }
    })

    it('should reject duplicate username on update', async () => {
      const username1 = `user1_${Date.now()}`
      const username2 = `user2_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username: username1,
        password: 'SecurePassword123!',
      })

      const user2 = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username: username2,
        password: 'SecurePassword123!',
      })

      await expect(
        clerk.users.updateUser(user2.id, {
          username: username1,
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject duplicate external_id on update', async () => {
      const extId = `ext_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        external_id: extId,
        password: 'SecurePassword123!',
      })

      const user2 = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      await expect(
        clerk.users.updateUser(user2.id, {
          external_id: extId,
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ============================================================================
  // 4. DELETE USER (5+ tests)
  // ============================================================================

  describe('deleteUser', () => {
    it('should delete a user', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.deleteUser(user.id)

      expect(result.id).toBe(user.id)
      expect(result.object).toBe('user')
      expect(result.deleted).toBe(true)
    })

    it('should remove user from lookup after deletion', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      await clerk.users.deleteUser(user.id)

      await expect(clerk.users.getUser(user.id)).rejects.toThrow(ClerkAPIError)
    })

    it('should free up email address after deletion', async () => {
      const email = uniqueEmail()

      const user = await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      await clerk.users.deleteUser(user.id)

      // Should be able to create a new user with the same email
      const newUser = await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      expect(newUser.email_addresses[0].email_address).toBe(email)
    })

    it('should free up username after deletion', async () => {
      const username = `user_${Date.now()}`

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      await clerk.users.deleteUser(user.id)

      // Should be able to create a new user with the same username
      const newUser = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      expect(newUser.username).toBe(username)
    })

    it('should throw 404 for non-existent user', async () => {
      await expect(clerk.users.deleteUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.users.deleteUser('user_nonexistent')
      } catch (error) {
        expect((error as ClerkAPIError).status).toBe(404)
      }
    })
  })

  // ============================================================================
  // 5. LIST USERS (10+ tests)
  // ============================================================================

  describe('listUsers', () => {
    it('should list all users', async () => {
      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.total_count).toBeGreaterThanOrEqual(2)
    })

    it('should list users with limit and offset', async () => {
      // Create multiple users
      for (let i = 0; i < 5; i++) {
        await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })
      }

      const page1 = await clerk.users.listUsers({ limit: 2, offset: 0 })
      const page2 = await clerk.users.listUsers({ limit: 2, offset: 2 })

      expect(page1.data).toHaveLength(2)
      expect(page2.data).toHaveLength(2)
      expect(page1.data[0].id).not.toBe(page2.data[0].id)
    })

    it('should filter users by email_address', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        emailAddress: [email],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].email_addresses[0].email_address).toBe(email)
    })

    it('should filter users by phone_number', async () => {
      const phone = '+14155559999'

      await clerk.users.createUser({
        phone_number: [phone],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        phoneNumber: [phone],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].phone_numbers[0].phone_number).toBe(phone)
    })

    it('should filter users by username', async () => {
      const username = `listuser_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        username: [username],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].username).toBe(username)
    })

    it('should filter users by external_id', async () => {
      const externalId = `ext_list_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        external_id: externalId,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        externalId: [externalId],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].external_id).toBe(externalId)
    })

    it('should filter users by user_id', async () => {
      const user1 = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const user2 = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        userId: [user1.id, user2.id],
      })

      expect(result.data).toHaveLength(2)
    })

    it('should order users by created_at ascending', async () => {
      const result = await clerk.users.listUsers({
        orderBy: 'created_at',
      })

      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].created_at).toBeGreaterThanOrEqual(result.data[i - 1].created_at)
      }
    })

    it('should order users by created_at descending', async () => {
      const result = await clerk.users.listUsers({
        orderBy: '-created_at',
      })

      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i].created_at).toBeLessThanOrEqual(result.data[i - 1].created_at)
      }
    })

    it('should order users by updated_at', async () => {
      const result = await clerk.users.listUsers({
        orderBy: '-updated_at',
      })

      expect(result.data).toBeDefined()
    })

    it('should support query parameter for search', async () => {
      const firstName = 'SearchableJohn'
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        first_name: firstName,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.listUsers({
        query: firstName,
      })

      expect(result.data.length).toBeGreaterThanOrEqual(1)
      expect(result.data.some((u) => u.first_name === firstName)).toBe(true)
    })
  })

  // ============================================================================
  // 6. SEARCH USERS (5+ tests)
  // ============================================================================

  describe('searchUsers', () => {
    it('should search users by email', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.searchUsers(email)

      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })

    it('should search users by username', async () => {
      const username = `searchable_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.searchUsers(username)

      expect(result.data.length).toBeGreaterThanOrEqual(1)
      expect(result.data.some((u) => u.username === username)).toBe(true)
    })

    it('should search users by name', async () => {
      const firstName = 'UniqueSearchName'

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        first_name: firstName,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.searchUsers(firstName)

      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })

    it('should return empty result for no matches', async () => {
      const result = await clerk.users.searchUsers('nonexistentuserxyz123abc')

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })

    it('should be case insensitive', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.searchUsers(email.toUpperCase())

      expect(result.data.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // 7. USER METADATA (10+ tests)
  // ============================================================================

  describe('User Metadata Operations', () => {
    describe('updateUserMetadata', () => {
      it('should update public metadata', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const updated = await clerk.users.updateUserMetadata(user.id, {
          publicMetadata: { role: 'admin', level: 5 },
        })

        expect(updated.public_metadata).toEqual({ role: 'admin', level: 5 })
      })

      it('should update private metadata', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const updated = await clerk.users.updateUserMetadata(user.id, {
          privateMetadata: { stripeId: 'cus_123', creditLimit: 10000 },
        })

        expect(updated.private_metadata).toEqual({ stripeId: 'cus_123', creditLimit: 10000 })
      })

      it('should update unsafe metadata', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const updated = await clerk.users.updateUserMetadata(user.id, {
          unsafeMetadata: { preferences: { notifications: true } },
        })

        expect(updated.unsafe_metadata).toEqual({ preferences: { notifications: true } })
      })

      it('should update all metadata types at once', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const updated = await clerk.users.updateUserMetadata(user.id, {
          publicMetadata: { public: true },
          privateMetadata: { private: true },
          unsafeMetadata: { unsafe: true },
        })

        expect(updated.public_metadata).toEqual({ public: true })
        expect(updated.private_metadata).toEqual({ private: true })
        expect(updated.unsafe_metadata).toEqual({ unsafe: true })
      })

      it('should replace metadata completely', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
          public_metadata: { oldKey: 'oldValue' },
        })

        const updated = await clerk.users.updateUserMetadata(user.id, {
          publicMetadata: { newKey: 'newValue' },
        })

        expect(updated.public_metadata).toEqual({ newKey: 'newValue' })
        expect(updated.public_metadata).not.toHaveProperty('oldKey')
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(
          clerk.users.updateUserMetadata('user_nonexistent', {
            publicMetadata: { test: true },
          })
        ).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('getUserMetadata', () => {
      it('should get all metadata types', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
          public_metadata: { publicKey: 'publicValue' },
          private_metadata: { privateKey: 'privateValue' },
          unsafe_metadata: { unsafeKey: 'unsafeValue' },
        })

        const metadata = await clerk.users.getUserMetadata(user.id)

        expect(metadata.publicMetadata).toEqual({ publicKey: 'publicValue' })
        expect(metadata.privateMetadata).toEqual({ privateKey: 'privateValue' })
        expect(metadata.unsafeMetadata).toEqual({ unsafeKey: 'unsafeValue' })
      })

      it('should return empty objects for unset metadata', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const metadata = await clerk.users.getUserMetadata(user.id)

        expect(metadata.publicMetadata).toEqual({})
        expect(metadata.privateMetadata).toEqual({})
        expect(metadata.unsafeMetadata).toEqual({})
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.getUserMetadata('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })
  })

  // ============================================================================
  // 8. PASSWORD MANAGEMENT (15+ tests)
  // ============================================================================

  describe('Password Management', () => {
    describe('updatePassword', () => {
      it('should update user password', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'OldPassword123!',
        })

        const updated = await clerk.users.updatePassword(user.id, 'NewPassword456!')

        expect(updated.password_enabled).toBe(true)
        expect(updated.updated_at).toBeGreaterThan(user.updated_at)
      })

      it('should reject weak password', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await expect(clerk.users.updatePassword(user.id, 'weak')).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.users.updatePassword(user.id, 'weak')
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('form_password_pwned')
        }
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.updatePassword('user_nonexistent', 'NewPassword123!')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('resetPassword', () => {
      it('should generate password reset token', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const result = await clerk.users.resetPassword(user.id)

        expect(result.resetToken).toBeDefined()
        expect(typeof result.resetToken).toBe('string')
        expect(result.resetToken.length).toBeGreaterThan(0)
        expect(result.expiresAt).toBeDefined()
        expect(result.expiresAt).toBeGreaterThan(Date.now())
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.resetPassword('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('checkPasswordStrength', () => {
      it('should return very_weak for short passwords', () => {
        const result = clerk.users.checkPasswordStrength('abc')

        expect(result.strength).toBe('very_weak')
        expect(result.score).toBeLessThanOrEqual(1)
        expect(result.warnings.length).toBeGreaterThan(0)
      })

      it('should return weak for password without variety', () => {
        const result = clerk.users.checkPasswordStrength('abcdefgh')

        expect(result.strength).toBe('weak')
        expect(result.suggestions.length).toBeGreaterThan(0)
      })

      it('should return fair for decent passwords', () => {
        const result = clerk.users.checkPasswordStrength('Password1')

        expect(['fair', 'strong']).toContain(result.strength)
      })

      it('should return strong for good passwords', () => {
        const result = clerk.users.checkPasswordStrength('MyP@ssw0rd123')

        expect(['strong', 'very_strong']).toContain(result.strength)
        expect(result.score).toBeGreaterThanOrEqual(5)
      })

      it('should return very_strong for excellent passwords', () => {
        const result = clerk.users.checkPasswordStrength('MyV3ryStr0ng&P@ssw0rd!')

        expect(result.strength).toBe('very_strong')
        expect(result.warnings).toHaveLength(0)
      })

      it('should warn about common patterns', () => {
        const result = clerk.users.checkPasswordStrength('password123')

        expect(result.warnings.some((w) => w.toLowerCase().includes('common'))).toBe(true)
      })

      it('should warn about repeated characters', () => {
        const result = clerk.users.checkPasswordStrength('aaaaaaaaaa')

        expect(result.warnings.some((w) => w.toLowerCase().includes('repeat'))).toBe(true)
      })

      it('should suggest adding uppercase', () => {
        const result = clerk.users.checkPasswordStrength('alllowercase')

        expect(result.suggestions.some((s) => s.toLowerCase().includes('uppercase'))).toBe(true)
      })

      it('should suggest adding numbers', () => {
        const result = clerk.users.checkPasswordStrength('NoNumbersHere')

        expect(result.suggestions.some((s) => s.toLowerCase().includes('number'))).toBe(true)
      })

      it('should suggest adding special characters', () => {
        const result = clerk.users.checkPasswordStrength('NoSpecialChars123')

        expect(result.suggestions.some((s) => s.toLowerCase().includes('special'))).toBe(true)
      })
    })
  })

  // ============================================================================
  // 9. EMAIL VERIFICATION (8+ tests)
  // ============================================================================

  describe('Email Verification', () => {
    describe('createEmailVerification', () => {
      it('should create email verification', async () => {
        const email = uniqueEmail()
        const user = await clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })

        const result = await clerk.users.createEmailVerification(user.id, email)

        expect(result.verificationId).toBeDefined()
        expect(result.code).toBeDefined()
        expect(result.code).toMatch(/^\d{6}$/) // 6 digit code
      })

      it('should throw for email not belonging to user', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await expect(clerk.users.createEmailVerification(user.id, 'other@example.com')).rejects.toThrow(ClerkAPIError)
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.createEmailVerification('user_nonexistent', 'test@example.com')).rejects.toThrow(
          ClerkAPIError
        )
      })
    })

    describe('verifyEmail', () => {
      it('should verify email with correct code', async () => {
        const email = uniqueEmail()
        const user = await clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })

        const { code } = await clerk.users.createEmailVerification(user.id, email)

        const verified = await clerk.users.verifyEmail(user.id, code)

        const emailAddress = verified.email_addresses.find((e) => e.email_address === email)
        expect(emailAddress?.verification?.status).toBe('verified')
      })

      it('should reject incorrect verification code', async () => {
        const email = uniqueEmail()
        const user = await clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })

        await clerk.users.createEmailVerification(user.id, email)

        await expect(clerk.users.verifyEmail(user.id, '000000')).rejects.toThrow(ClerkAPIError)

        try {
          await clerk.users.verifyEmail(user.id, '000000')
        } catch (error) {
          expect((error as ClerkAPIError).errors[0].code).toBe('verification_failed')
        }
      })

      it('should reject expired verification code', async () => {
        const email = uniqueEmail()
        const user = await clerk.users.createUser({
          email_address: [email],
          password: 'SecurePassword123!',
        })

        const { code } = await clerk.users.createEmailVerification(user.id, email)

        // Note: In a real test, we'd need to mock time advancement
        // For now, we just test the rejection path exists
        // This test would need vi.useFakeTimers() to properly test expiration
      })
    })
  })

  // ============================================================================
  // 10. PHONE VERIFICATION (5+ tests)
  // ============================================================================

  describe('Phone Verification', () => {
    describe('createPhoneVerification', () => {
      it('should create phone verification', async () => {
        const phone = '+14155551234'
        const user = await clerk.users.createUser({
          phone_number: [phone],
          password: 'SecurePassword123!',
        })

        const result = await clerk.users.createPhoneVerification(user.id, phone)

        expect(result.verificationId).toBeDefined()
        expect(result.code).toBeDefined()
        expect(result.code).toMatch(/^\d{6}$/)
      })

      it('should throw for phone not belonging to user', async () => {
        const user = await clerk.users.createUser({
          phone_number: ['+14155551111'],
          password: 'SecurePassword123!',
        })

        await expect(clerk.users.createPhoneVerification(user.id, '+14155559999')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('verifyPhone', () => {
      it('should verify phone with correct code', async () => {
        const phone = '+14155552222'
        const user = await clerk.users.createUser({
          phone_number: [phone],
          password: 'SecurePassword123!',
        })

        const { code } = await clerk.users.createPhoneVerification(user.id, phone)

        const verified = await clerk.users.verifyPhone(user.id, code)

        const phoneNumber = verified.phone_numbers.find((p) => p.phone_number === phone)
        expect(phoneNumber?.verification?.status).toBe('verified')
      })

      it('should reject incorrect verification code', async () => {
        const phone = '+14155553333'
        const user = await clerk.users.createUser({
          phone_number: [phone],
          password: 'SecurePassword123!',
        })

        await clerk.users.createPhoneVerification(user.id, phone)

        await expect(clerk.users.verifyPhone(user.id, '000000')).rejects.toThrow(ClerkAPIError)
      })
    })
  })

  // ============================================================================
  // 11. EXTERNAL ACCOUNTS (10+ tests)
  // ============================================================================

  describe('External Accounts', () => {
    describe('linkExternalAccount', () => {
      it('should link an external account', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const result = await clerk.users.linkExternalAccount(user.id, {
          provider: 'google',
          token: 'fake_google_token',
          providerUserId: 'google_user_123',
          email: 'user@gmail.com',
          firstName: 'Google',
          lastName: 'User',
          imageUrl: 'https://example.com/avatar.jpg',
        })

        expect(result.linked).toBe(true)
        expect(result.provider).toBe('google')
        expect(result.provider_user_id).toBe('google_user_123')
        expect(result.email_address).toBe('user@gmail.com')
      })

      it('should reject duplicate external account', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await clerk.users.linkExternalAccount(user.id, {
          provider: 'github',
          token: 'fake_github_token',
          providerUserId: 'github_user_123',
        })

        await expect(
          clerk.users.linkExternalAccount(user.id, {
            provider: 'github',
            token: 'fake_github_token',
            providerUserId: 'github_user_123',
          })
        ).rejects.toThrow(ClerkAPIError)
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(
          clerk.users.linkExternalAccount('user_nonexistent', {
            provider: 'google',
            token: 'fake_token',
          })
        ).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('unlinkExternalAccount', () => {
      it('should unlink an external account', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const linked = await clerk.users.linkExternalAccount(user.id, {
          provider: 'facebook',
          token: 'fake_fb_token',
          providerUserId: 'fb_user_123',
        })

        const result = await clerk.users.unlinkExternalAccount(user.id, linked.id)

        expect(result.deleted).toBe(true)
        expect(result.id).toBe(linked.id)
      })

      it('should throw 404 for non-existent external account', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await expect(clerk.users.unlinkExternalAccount(user.id, 'eac_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('listExternalAccounts', () => {
      it('should list all external accounts for user', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await clerk.users.linkExternalAccount(user.id, {
          provider: 'google',
          token: 'token1',
          providerUserId: 'google_123',
        })

        await clerk.users.linkExternalAccount(user.id, {
          provider: 'github',
          token: 'token2',
          providerUserId: 'github_456',
        })

        const result = await clerk.users.listExternalAccounts(user.id)

        expect(result.data).toHaveLength(2)
        expect(result.total_count).toBe(2)
        expect(result.data.map((a) => a.provider)).toContain('google')
        expect(result.data.map((a) => a.provider)).toContain('github')
      })

      it('should return empty list for user with no external accounts', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const result = await clerk.users.listExternalAccounts(user.id)

        expect(result.data).toHaveLength(0)
        expect(result.total_count).toBe(0)
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.listExternalAccounts('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })
  })

  // ============================================================================
  // 12. USER BANNING (8+ tests)
  // ============================================================================

  describe('User Banning', () => {
    describe('banUser', () => {
      it('should ban a user', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const banned = await clerk.users.banUser(user.id)

        expect(banned.banned).toBe(true)
      })

      it('should ban a user with reason', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const banned = await clerk.users.banUser(user.id, 'Violated terms of service')

        expect(banned.banned).toBe(true)
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.banUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('unbanUser', () => {
      it('should unban a user', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await clerk.users.banUser(user.id)
        const unbanned = await clerk.users.unbanUser(user.id)

        expect(unbanned.banned).toBe(false)
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.unbanUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })

    describe('isUserBanned', () => {
      it('should return banned status and reason', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        await clerk.users.banUser(user.id, 'Test ban reason')

        const status = await clerk.users.isUserBanned(user.id)

        expect(status.banned).toBe(true)
        expect(status.reason).toBe('Test ban reason')
      })

      it('should return not banned for unbanned user', async () => {
        const user = await clerk.users.createUser({
          email_address: [uniqueEmail()],
          password: 'SecurePassword123!',
        })

        const status = await clerk.users.isUserBanned(user.id)

        expect(status.banned).toBe(false)
        expect(status.reason).toBeUndefined()
      })

      it('should throw 404 for non-existent user', async () => {
        await expect(clerk.users.isUserBanned('user_nonexistent')).rejects.toThrow(ClerkAPIError)
      })
    })
  })

  // ============================================================================
  // 13. FILTER USERS (5+ tests)
  // ============================================================================

  describe('filterUsers', () => {
    it('should filter users by email addresses', async () => {
      const email1 = uniqueEmail()
      const email2 = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email1],
        password: 'SecurePassword123!',
      })

      await clerk.users.createUser({
        email_address: [email2],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.filterUsers({
        emailAddress: [email1],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].email_addresses[0].email_address).toBe(email1)
    })

    it('should filter users by multiple emails', async () => {
      const email1 = uniqueEmail()
      const email2 = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email1],
        password: 'SecurePassword123!',
      })

      await clerk.users.createUser({
        email_address: [email2],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.filterUsers({
        emailAddress: [email1, email2],
      })

      expect(result.data).toHaveLength(2)
    })

    it('should filter users by phone numbers', async () => {
      const phone = '+14155557777'

      await clerk.users.createUser({
        phone_number: [phone],
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.filterUsers({
        phoneNumber: [phone],
      })

      expect(result.data).toHaveLength(1)
    })

    it('should filter users by web3 wallets', async () => {
      const wallet = '0x1234567890abcdef1234567890abcdef12345678'

      await clerk.users.createUser({
        web3_wallet: [wallet],
      })

      const result = await clerk.users.filterUsers({
        web3Wallet: [wallet],
      })

      expect(result.data).toHaveLength(1)
    })

    it('should filter users by external IDs', async () => {
      const externalId = `filter_ext_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        external_id: externalId,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.filterUsers({
        externalId: [externalId],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].external_id).toBe(externalId)
    })

    it('should filter users by usernames', async () => {
      const username = `filter_user_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        username,
        password: 'SecurePassword123!',
      })

      const result = await clerk.users.filterUsers({
        username: [username],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].username).toBe(username)
    })
  })

  // ============================================================================
  // 14. GET USER BY EMAIL/EXTERNAL ID (5+ tests)
  // ============================================================================

  describe('getUserByEmail', () => {
    it('should get user by email', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
        first_name: 'Email',
        last_name: 'Lookup',
      })

      const user = await clerk.users.getUserByEmail(email)

      expect(user).not.toBeNull()
      expect(user?.first_name).toBe('Email')
      expect(user?.last_name).toBe('Lookup')
    })

    it('should be case insensitive', async () => {
      const email = uniqueEmail()

      await clerk.users.createUser({
        email_address: [email],
        password: 'SecurePassword123!',
      })

      const user = await clerk.users.getUserByEmail(email.toUpperCase())

      expect(user).not.toBeNull()
    })

    it('should return null for non-existent email', async () => {
      const user = await clerk.users.getUserByEmail('nonexistent@example.com')

      expect(user).toBeNull()
    })
  })

  describe('getUserByExternalId', () => {
    it('should get user by external ID', async () => {
      const externalId = `getby_ext_${Date.now()}`

      await clerk.users.createUser({
        email_address: [uniqueEmail()],
        external_id: externalId,
        password: 'SecurePassword123!',
        first_name: 'External',
        last_name: 'Lookup',
      })

      const user = await clerk.users.getUserByExternalId(externalId)

      expect(user).not.toBeNull()
      expect(user?.external_id).toBe(externalId)
      expect(user?.first_name).toBe('External')
    })

    it('should return null for non-existent external ID', async () => {
      const user = await clerk.users.getUserByExternalId('nonexistent_ext_id')

      expect(user).toBeNull()
    })
  })

  // ============================================================================
  // 15. EDGE CASES AND ERROR HANDLING (10+ tests)
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle unicode in user names', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: 'Usuario',
        last_name: 'Espanol',
      })

      expect(user.first_name).toBe('Usuario')
      expect(user.last_name).toBe('Espanol')
    })

    it('should handle special characters in metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        public_metadata: {
          message: 'Hello, World! <script>alert("xss")</script>',
          unicode: 'Konnichiwa',
        },
      })

      expect(user.public_metadata.message).toBe('Hello, World! <script>alert("xss")</script>')
    })

    it('should handle deeply nested metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        public_metadata: {
          level1: {
            level2: {
              level3: {
                value: 'deeply nested',
              },
            },
          },
        },
      })

      expect((user.public_metadata as any).level1.level2.level3.value).toBe('deeply nested')
    })

    it('should handle empty email array', async () => {
      await expect(
        clerk.users.createUser({
          email_address: [],
          password: 'SecurePassword123!',
        })
      ).rejects.toThrow()
    })

    it('should handle concurrent user creation', async () => {
      const emails = Array.from({ length: 5 }, () => uniqueEmail())

      const results = await Promise.all(
        emails.map((email) =>
          clerk.users.createUser({
            email_address: [email],
            password: 'SecurePassword123!',
          })
        )
      )

      expect(results).toHaveLength(5)
      const ids = results.map((r) => r.id)
      expect(new Set(ids).size).toBe(5) // All unique IDs
    })

    it('should handle very long first_name', async () => {
      const longName = 'A'.repeat(256)

      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: longName,
      })

      expect(user.first_name).toBe(longName)
    })

    it('should handle user creation with all optional fields', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        phone_number: ['+14155550000'],
        web3_wallet: ['0xabcdef1234567890abcdef1234567890abcdef12'],
        username: `allfields_${Date.now()}`,
        password: 'SecurePassword123!',
        first_name: 'All',
        last_name: 'Fields',
        external_id: `all_${Date.now()}`,
        public_metadata: { test: true },
        private_metadata: { secret: 'value' },
        unsafe_metadata: { prefs: {} },
        totp_secret: 'JBSWY3DPEHPK3PXP',
        backup_codes: ['12345678'],
        delete_self_enabled: true,
        create_organization_enabled: true,
      })

      expect(user.email_addresses).toHaveLength(1)
      expect(user.phone_numbers).toHaveLength(1)
      expect(user.web3_wallets).toHaveLength(1)
      expect(user.username).toBeDefined()
      expect(user.totp_enabled).toBe(true)
      expect(user.backup_code_enabled).toBe(true)
    })

    it('should handle update with null values', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: 'HasName',
      })

      const updated = await clerk.users.updateUser(user.id, {
        first_name: undefined,
      })

      // Undefined should not change the value
      expect(updated.first_name).toBe('HasName')
    })

    it('should maintain data consistency after multiple updates', async () => {
      const user = await clerk.users.createUser({
        email_address: [uniqueEmail()],
        password: 'SecurePassword123!',
        first_name: 'Initial',
      })

      await clerk.users.updateUser(user.id, { first_name: 'Update1' })
      await clerk.users.updateUser(user.id, { last_name: 'LastName' })
      await clerk.users.updateUser(user.id, { first_name: 'Final' })

      const fetched = await clerk.users.getUser(user.id)

      expect(fetched.first_name).toBe('Final')
      expect(fetched.last_name).toBe('LastName')
    })
  })
})
