/**
 * @dotdo/clerk - Clerk Users Compatibility Layer Tests
 *
 * Tests for Clerk User API compatibility.
 *
 * Tests cover the Clerk Backend API for users:
 * - Create user
 * - Get user
 * - Update user
 * - Delete user
 * - List users
 * - User metadata management
 * - Ban/unban users
 * - Lock/unlock users
 * - Password verification
 * - TOTP verification
 * - MFA management
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type User,
  type UserList,
  type CreateUserParams,
  type UpdateUserParams,
  type ListUsersParams,
  type UpdateUserMetadataParams,
  type DeletedObject,
  type EmailAddress,
  type PhoneNumber,
  type ExternalAccount,
  type OrganizationMembership,
} from '../index'

// =============================================================================
// Mock Helpers
// =============================================================================

const mockFetch = vi.fn()

function createMockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Creates a mock email address object
 */
function mockEmailAddress(overrides: Partial<EmailAddress> = {}): EmailAddress {
  const now = Date.now()
  return {
    id: 'idn_test123',
    object: 'email_address',
    email_address: 'user@example.com',
    verification: {
      status: 'verified',
      strategy: 'email_link',
    },
    linked_to: [],
    created_at: now - 60 * 60 * 1000,
    updated_at: now,
    ...overrides,
  }
}

/**
 * Creates a mock phone number object
 */
function mockPhoneNumber(overrides: Partial<PhoneNumber> = {}): PhoneNumber {
  const now = Date.now()
  return {
    id: 'idn_phone123',
    object: 'phone_number',
    phone_number: '+15551234567',
    reserved_for_second_factor: false,
    default_second_factor: false,
    verification: {
      status: 'verified',
      strategy: 'phone_code',
    },
    linked_to: [],
    created_at: now - 60 * 60 * 1000,
    updated_at: now,
    ...overrides,
  }
}

/**
 * Creates a mock Clerk user object matching the Clerk API response format
 */
function mockUser(overrides: Partial<User> = {}): User {
  const now = Date.now()
  return {
    id: 'user_test123',
    object: 'user',
    username: 'testuser',
    first_name: 'Test',
    last_name: 'User',
    image_url: 'https://img.clerk.com/user_test123.png',
    has_image: true,
    primary_email_address_id: 'idn_test123',
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: true,
    two_factor_enabled: false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [mockEmailAddress()],
    phone_numbers: [],
    external_accounts: [],
    public_metadata: {},
    private_metadata: {},
    unsafe_metadata: {},
    external_id: null,
    last_sign_in_at: now - 60 * 60 * 1000,
    banned: false,
    locked: false,
    lockout_expires_in_seconds: null,
    verification_attempts_remaining: null,
    created_at: now - 7 * 24 * 60 * 60 * 1000,
    updated_at: now,
    last_active_at: now - 60 * 1000,
    profile_image_url: 'https://img.clerk.com/user_test123.png',
    ...overrides,
  }
}

/**
 * Creates a mock Clerk user list response
 */
function mockUserList(users: User[], totalCount?: number): UserList {
  return {
    data: users,
    total_count: totalCount ?? users.length,
  }
}

// =============================================================================
// Users Resource Tests
// =============================================================================

describe('@dotdo/clerk - Users', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Users Resource Exists
  // ===========================================================================

  describe('users resource', () => {
    it('should have users resource available', () => {
      expect(clerk.users).toBeDefined()
    })

    it('should have all user methods', () => {
      expect(clerk.users.createUser).toBeDefined()
      expect(clerk.users.getUser).toBeDefined()
      expect(clerk.users.updateUser).toBeDefined()
      expect(clerk.users.deleteUser).toBeDefined()
      expect(clerk.users.listUsers).toBeDefined()
      expect(clerk.users.getUsersCount).toBeDefined()
      expect(clerk.users.updateUserMetadata).toBeDefined()
      expect(clerk.users.banUser).toBeDefined()
      expect(clerk.users.unbanUser).toBeDefined()
      expect(clerk.users.lockUser).toBeDefined()
      expect(clerk.users.unlockUser).toBeDefined()
      expect(clerk.users.verifyPassword).toBeDefined()
      expect(clerk.users.verifyTOTP).toBeDefined()
      expect(clerk.users.disableMFA).toBeDefined()
    })
  })

  // ===========================================================================
  // Create User
  // ===========================================================================

  describe('createUser', () => {
    it('should create a user with email', async () => {
      const expectedUser = mockUser()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        emailAddress: ['user@example.com'],
      })

      expect(user.id).toBe('user_test123')
      expect(user.object).toBe('user')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_xxx',
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should create a user with password', async () => {
      const expectedUser = mockUser({ password_enabled: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        emailAddress: ['user@example.com'],
        password: 'SecurePassword123!',
      })

      expect(user.password_enabled).toBe(true)
    })

    it('should create a user with name', async () => {
      const expectedUser = mockUser({
        first_name: 'John',
        last_name: 'Doe',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        emailAddress: ['john@example.com'],
        firstName: 'John',
        lastName: 'Doe',
      })

      expect(user.first_name).toBe('John')
      expect(user.last_name).toBe('Doe')
    })

    it('should create a user with username', async () => {
      const expectedUser = mockUser({ username: 'johndoe' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        username: 'johndoe',
        password: 'SecurePassword123!',
      })

      expect(user.username).toBe('johndoe')
    })

    it('should create a user with phone number', async () => {
      const expectedUser = mockUser({
        phone_numbers: [mockPhoneNumber()],
        primary_phone_number_id: 'idn_phone123',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        phoneNumber: ['+15551234567'],
      })

      expect(user.phone_numbers).toHaveLength(1)
    })

    it('should create a user with external_id', async () => {
      const expectedUser = mockUser({ external_id: 'ext_123' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        emailAddress: ['user@example.com'],
        externalId: 'ext_123',
      })

      expect(user.external_id).toBe('ext_123')
    })

    it('should create a user with metadata', async () => {
      const publicMetadata = { plan: 'pro' }
      const privateMetadata = { stripeId: 'cus_xxx' }
      const unsafeMetadata = { theme: 'dark' }
      const expectedUser = mockUser({
        public_metadata: publicMetadata,
        private_metadata: privateMetadata,
        unsafe_metadata: unsafeMetadata,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.createUser({
        emailAddress: ['user@example.com'],
        publicMetadata,
        privateMetadata,
        unsafeMetadata,
      })

      expect(user.public_metadata).toEqual(publicMetadata)
      expect(user.private_metadata).toEqual(privateMetadata)
      expect(user.unsafe_metadata).toEqual(unsafeMetadata)
    })

    it('should handle duplicate email error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'form_identifier_exists',
            message: 'That email address is taken. Please try another.',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.users.createUser({
          emailAddress: ['existing@example.com'],
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle weak password error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'form_password_pwned',
            message: 'Password has been found in an online data breach.',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.users.createUser({
          emailAddress: ['user@example.com'],
          password: 'password123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Get User
  // ===========================================================================

  describe('getUser', () => {
    it('should retrieve a user by ID', async () => {
      const expectedUser = mockUser()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedUser))

      const user = await clerk.users.getUser('user_test123')

      expect(user.id).toBe('user_test123')
      expect(user.object).toBe('user')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return user with all fields populated', async () => {
      const fullUser = mockUser({
        email_addresses: [mockEmailAddress()],
        phone_numbers: [mockPhoneNumber()],
        two_factor_enabled: true,
        totp_enabled: true,
        backup_code_enabled: true,
        public_metadata: { plan: 'enterprise' },
        private_metadata: { internal_notes: 'VIP customer' },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(fullUser))

      const user = await clerk.users.getUser('user_test123')

      expect(user.email_addresses).toHaveLength(1)
      expect(user.phone_numbers).toHaveLength(1)
      expect(user.two_factor_enabled).toBe(true)
      expect(user.totp_enabled).toBe(true)
      expect(user.backup_code_enabled).toBe(true)
    })

    it('should handle user not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(clerk.users.getUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Update User
  // ===========================================================================

  describe('updateUser', () => {
    it('should update user name', async () => {
      const updatedUser = mockUser({
        first_name: 'Updated',
        last_name: 'Name',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        firstName: 'Updated',
        lastName: 'Name',
      })

      expect(user.first_name).toBe('Updated')
      expect(user.last_name).toBe('Name')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
    })

    it('should update user username', async () => {
      const updatedUser = mockUser({ username: 'newusername' })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        username: 'newusername',
      })

      expect(user.username).toBe('newusername')
    })

    it('should update user password', async () => {
      const updatedUser = mockUser({ password_enabled: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        password: 'NewSecurePassword123!',
      })

      expect(user.password_enabled).toBe(true)
    })

    it('should update user primary email address', async () => {
      const updatedUser = mockUser({ primary_email_address_id: 'idn_new123' })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        primaryEmailAddressId: 'idn_new123',
      })

      expect(user.primary_email_address_id).toBe('idn_new123')
    })

    it('should update user external_id', async () => {
      const updatedUser = mockUser({ external_id: 'new_ext_123' })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        externalId: 'new_ext_123',
      })

      expect(user.external_id).toBe('new_ext_123')
    })

    it('should update user metadata', async () => {
      const publicMetadata = { tier: 'enterprise' }
      const privateMetadata = { billing_tier: 'premium' }
      const updatedUser = mockUser({
        public_metadata: publicMetadata,
        private_metadata: privateMetadata,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUser('user_test123', {
        publicMetadata,
        privateMetadata,
      })

      expect(user.public_metadata).toEqual(publicMetadata)
      expect(user.private_metadata).toEqual(privateMetadata)
    })

    it('should handle user not found on update', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.users.updateUser('user_nonexistent', {
          firstName: 'New',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle username conflict', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_identifier_exists',
                message: 'That username is taken. Please try another.',
              },
            ],
          },
          422
        )
      )

      await expect(
        clerk.users.updateUser('user_test123', {
          username: 'existingusername',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Delete User
  // ===========================================================================

  describe('deleteUser', () => {
    it('should delete a user by ID', async () => {
      const deletedObject: DeletedObject = {
        object: 'user',
        id: 'user_test123',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedObject))

      const result = await clerk.users.deleteUser('user_test123')

      expect(result.id).toBe('user_test123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should handle user not found on delete', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(clerk.users.deleteUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // List Users
  // ===========================================================================

  describe('listUsers', () => {
    it('should list all users', async () => {
      const users = [mockUser(), mockUser({ id: 'user_test456', username: 'anotheruser' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers()

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })

    it('should filter users by email address', async () => {
      const users = [mockUser()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        emailAddress: ['user@example.com'],
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('email_address=user%40example.com'),
        expect.anything()
      )
    })

    it('should filter users by phone number', async () => {
      const users = [mockUser({ phone_numbers: [mockPhoneNumber()] })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        phoneNumber: ['+15551234567'],
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('phone_number'), expect.anything())
    })

    it('should filter users by external_id', async () => {
      const users = [mockUser({ external_id: 'ext_123' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        externalId: ['ext_123'],
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('external_id=ext_123'), expect.anything())
    })

    it('should filter users by username', async () => {
      const users = [mockUser({ username: 'testuser' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        username: ['testuser'],
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('username=testuser'), expect.anything())
    })

    it('should filter users by query', async () => {
      const users = [mockUser({ first_name: 'John', last_name: 'Doe' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        query: 'john',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('query=john'), expect.anything())
    })

    it('should support pagination with limit', async () => {
      const users = [mockUser()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users, 10)))

      const result = await clerk.users.listUsers({
        limit: 1,
      })

      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(10)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=1'), expect.anything())
    })

    it('should support pagination with offset', async () => {
      const users = [mockUser({ id: 'user_test456' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users, 10)))

      const result = await clerk.users.listUsers({
        offset: 5,
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('offset=5'), expect.anything())
    })

    it('should support ordering', async () => {
      const users = [mockUser()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        orderBy: '-created_at',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('order_by=-created_at'), expect.anything())
    })

    it('should return empty list when no users exist', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList([])))

      const result = await clerk.users.listUsers()

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })

    it('should filter by organization_id', async () => {
      const users = [mockUser()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        organizationId: ['org_test123'],
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('organization_id=org_test123'), expect.anything())
    })

    it('should filter by last_active_at_since', async () => {
      const users = [mockUser()]
      const since = Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days ago
      mockFetch.mockResolvedValueOnce(createMockResponse(mockUserList(users)))

      const result = await clerk.users.listUsers({
        lastActiveAtSince: since,
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('last_active_at_since=' + since),
        expect.anything()
      )
    })
  })

  // ===========================================================================
  // Get Users Count
  // ===========================================================================

  describe('getUsersCount', () => {
    it('should get total users count', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'total_count',
          total_count: 150,
        })
      )

      const result = await clerk.users.getUsersCount()

      expect(result.total_count).toBe(150)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/users/count'), expect.anything())
    })

    it('should get filtered users count', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'total_count',
          total_count: 25,
        })
      )

      const result = await clerk.users.getUsersCount({
        organizationId: ['org_test123'],
      })

      expect(result.total_count).toBe(25)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('organization_id=org_test123'),
        expect.anything()
      )
    })
  })

  // ===========================================================================
  // Update User Metadata
  // ===========================================================================

  describe('updateUserMetadata', () => {
    it('should update public metadata', async () => {
      const publicMetadata = { tier: 'enterprise', features: ['sso', 'audit-logs'] }
      const updatedUser = mockUser({ public_metadata: publicMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUserMetadata('user_test123', {
        publicMetadata,
      })

      expect(user.public_metadata).toEqual(publicMetadata)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/metadata'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
    })

    it('should update private metadata', async () => {
      const privateMetadata = { stripe_id: 'cus_xxx', internal_notes: 'Priority support' }
      const updatedUser = mockUser({ private_metadata: privateMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUserMetadata('user_test123', {
        privateMetadata,
      })

      expect(user.private_metadata).toEqual(privateMetadata)
    })

    it('should update unsafe metadata', async () => {
      const unsafeMetadata = { theme: 'dark', language: 'en' }
      const updatedUser = mockUser({ unsafe_metadata: unsafeMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const user = await clerk.users.updateUserMetadata('user_test123', {
        unsafeMetadata,
      })

      expect(user.unsafe_metadata).toEqual(unsafeMetadata)
    })

    it('should handle user not found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.users.updateUserMetadata('user_nonexistent', {
          publicMetadata: { foo: 'bar' },
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Ban/Unban Users
  // ===========================================================================

  describe('banUser', () => {
    it('should ban a user', async () => {
      const bannedUser = mockUser({ banned: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(bannedUser))

      const user = await clerk.users.banUser('user_test123')

      expect(user.banned).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/ban'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should handle user not found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(clerk.users.banUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('unbanUser', () => {
    it('should unban a user', async () => {
      const unbannedUser = mockUser({ banned: false })
      mockFetch.mockResolvedValueOnce(createMockResponse(unbannedUser))

      const user = await clerk.users.unbanUser('user_test123')

      expect(user.banned).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/unban'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  // ===========================================================================
  // Lock/Unlock Users
  // ===========================================================================

  describe('lockUser', () => {
    it('should lock a user', async () => {
      const lockedUser = mockUser({ locked: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(lockedUser))

      const user = await clerk.users.lockUser('user_test123')

      expect(user.locked).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/lock'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  describe('unlockUser', () => {
    it('should unlock a user', async () => {
      const unlockedUser = mockUser({ locked: false })
      mockFetch.mockResolvedValueOnce(createMockResponse(unlockedUser))

      const user = await clerk.users.unlockUser('user_test123')

      expect(user.locked).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/unlock'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })
  })

  // ===========================================================================
  // Password Verification
  // ===========================================================================

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          verified: true,
        })
      )

      const result = await clerk.users.verifyPassword('user_test123', 'CorrectPassword123!')

      expect(result.verified).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/verify_password'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('CorrectPassword123!'),
        })
      )
    })

    it('should reject incorrect password', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          verified: false,
        })
      )

      const result = await clerk.users.verifyPassword('user_test123', 'WrongPassword')

      expect(result.verified).toBe(false)
    })

    it('should handle user not found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User not found',
              },
            ],
          },
          404
        )
      )

      await expect(clerk.users.verifyPassword('user_nonexistent', 'password')).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // TOTP Verification
  // ===========================================================================

  describe('verifyTOTP', () => {
    it('should verify correct TOTP code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          verified: true,
          code_type: 'totp',
        })
      )

      const result = await clerk.users.verifyTOTP('user_test123', '123456')

      expect(result.verified).toBe(true)
      expect(result.code_type).toBe('totp')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/verify_totp'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should verify backup code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          verified: true,
          code_type: 'backup_code',
        })
      )

      const result = await clerk.users.verifyTOTP('user_test123', 'backup-code-xxx')

      expect(result.verified).toBe(true)
      expect(result.code_type).toBe('backup_code')
    })

    it('should reject incorrect TOTP code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          verified: false,
          code_type: 'totp',
        })
      )

      const result = await clerk.users.verifyTOTP('user_test123', '000000')

      expect(result.verified).toBe(false)
    })
  })

  // ===========================================================================
  // MFA Management
  // ===========================================================================

  describe('disableMFA', () => {
    it('should disable MFA for a user', async () => {
      const userWithoutMFA = mockUser({
        two_factor_enabled: false,
        totp_enabled: false,
        backup_code_enabled: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(userWithoutMFA))

      const user = await clerk.users.disableMFA('user_test123')

      expect(user.two_factor_enabled).toBe(false)
      expect(user.totp_enabled).toBe(false)
      expect(user.backup_code_enabled).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/mfa'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  // ===========================================================================
  // Organization Memberships
  // ===========================================================================

  describe('getUserOrganizationMemberships', () => {
    it('should get organization memberships for a user', async () => {
      const memberships = [
        {
          id: 'mem_test123',
          object: 'organization_membership',
          organization: {
            id: 'org_test123',
            object: 'organization',
            name: 'Test Org',
            slug: 'test-org',
            image_url: null,
            has_image: false,
            members_count: 5,
            pending_invitations_count: 0,
            max_allowed_memberships: 100,
            admin_delete_enabled: true,
            public_metadata: {},
            private_metadata: {},
            created_by: 'user_test123',
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          public_metadata: {},
          private_metadata: {},
          role: 'admin',
          permissions: ['org:member:create', 'org:member:delete'],
          created_at: Date.now(),
          updated_at: Date.now(),
        },
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: memberships,
          total_count: 1,
        })
      )

      const result = await clerk.users.getUserOrganizationMemberships('user_test123')

      expect(result.data).toHaveLength(1)
      expect(result.data[0].role).toBe('admin')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/organization_memberships'),
        expect.anything()
      )
    })

    it('should support pagination', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 10,
        })
      )

      await clerk.users.getUserOrganizationMemberships('user_test123', {
        limit: 5,
        offset: 5,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=5'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// User Types Tests
// =============================================================================

describe('@dotdo/clerk - User Types', () => {
  it('should export User type', () => {
    const user: User = {
      id: 'user_test123',
      object: 'user',
      username: 'testuser',
      first_name: 'Test',
      last_name: 'User',
      image_url: 'https://example.com/image.png',
      has_image: true,
      primary_email_address_id: 'idn_test123',
      primary_phone_number_id: null,
      primary_web3_wallet_id: null,
      password_enabled: true,
      two_factor_enabled: false,
      totp_enabled: false,
      backup_code_enabled: false,
      email_addresses: [],
      phone_numbers: [],
      external_accounts: [],
      public_metadata: {},
      private_metadata: {},
      unsafe_metadata: {},
      external_id: null,
      last_sign_in_at: null,
      banned: false,
      locked: false,
      lockout_expires_in_seconds: null,
      verification_attempts_remaining: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      last_active_at: null,
      profile_image_url: 'https://example.com/image.png',
    }
    expect(user.object).toBe('user')
  })

  it('should export UserList type', () => {
    const list: UserList = {
      data: [],
      total_count: 0,
    }
    expect(list.total_count).toBe(0)
  })

  it('should export CreateUserParams type', () => {
    const params: CreateUserParams = {
      emailAddress: ['test@example.com'],
    }
    expect(params.emailAddress).toHaveLength(1)
  })

  it('should export UpdateUserParams type', () => {
    const params: UpdateUserParams = {
      firstName: 'Updated',
    }
    expect(params.firstName).toBe('Updated')
  })

  it('should export ListUsersParams type', () => {
    const params: ListUsersParams = {
      limit: 10,
    }
    expect(params.limit).toBe(10)
  })
})

// =============================================================================
// User Error Handling Tests
// =============================================================================

describe('@dotdo/clerk - User Error Handling', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle rate limiting for user operations', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        {
          errors: [
            {
              code: 'rate_limit_exceeded',
              message: 'Too many requests',
            },
          ],
        },
        429
      )
    )

    await expect(clerk.users.listUsers()).rejects.toThrow(ClerkAPIError)

    try {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [{ code: 'rate_limit_exceeded', message: 'Too many requests' }],
          },
          429
        )
      )
      await clerk.users.listUsers()
    } catch (error) {
      expect((error as ClerkAPIError).status).toBe(429)
      expect((error as ClerkAPIError).code).toBe('rate_limit_exceeded')
    }
  })

  it('should handle authentication errors for user operations', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        {
          errors: [
            {
              code: 'authentication_invalid',
              message: 'Invalid API key',
            },
          ],
        },
        401
      )
    )

    await expect(clerk.users.getUser('user_test123')).rejects.toThrow(ClerkAPIError)
  })

  it('should handle server errors for user operations', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        {
          errors: [
            {
              code: 'internal_server_error',
              message: 'An unexpected error occurred',
            },
          ],
        },
        500
      )
    )

    await expect(
      clerk.users.createUser({ emailAddress: ['test@example.com'] })
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle network errors for user operations', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(clerk.users.getUser('user_test123')).rejects.toThrow('Network error')
  })

  it('should handle permission denied errors', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        {
          errors: [
            {
              code: 'permission_denied',
              message: 'You do not have permission to perform this action',
            },
          ],
        },
        403
      )
    )

    await expect(clerk.users.deleteUser('user_test123')).rejects.toThrow(ClerkAPIError)
  })
})
