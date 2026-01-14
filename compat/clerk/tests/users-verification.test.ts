/**
 * @dotdo/clerk - Clerk Users Verification & Advanced Features Tests (RED Phase)
 *
 * These tests cover features that need to be implemented:
 * - Email verification
 * - Phone verification
 * - External account management
 * - Password management (updatePassword, resetPassword, checkPasswordStrength)
 * - Search and filter users
 * - User lookup by email/external_id
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type User,
  type EmailAddress,
  type PhoneNumber,
  type ExternalAccount,
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
    email_addresses: [],
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

// =============================================================================
// Email Verification Tests
// =============================================================================

describe('@dotdo/clerk - Email Verification', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createEmailVerification', () => {
    it('should create an email verification and return code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          id: 'ver_test123',
          code: '123456',
          expires_at: Date.now() + 600000,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createEmailVerification('user_test123', 'user@example.com')

      expect(result.id).toBe('ver_test123')
      expect(result.code).toBe('123456')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/email_addresses'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should throw error for email not belonging to user', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Email address not found for this user',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.createEmailVerification('user_test123', 'other@example.com')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('verifyEmail', () => {
    it('should verify email with correct code', async () => {
      const userWithVerifiedEmail = mockUser({
        email_addresses: [
          {
            id: 'idn_test123',
            object: 'email_address',
            email_address: 'user@example.com',
            verification: { status: 'verified', strategy: 'email_code' },
            linked_to: [],
            created_at: Date.now() - 3600000,
            updated_at: Date.now(),
          },
        ],
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(userWithVerifiedEmail))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.verifyEmail('user_test123', '123456')

      expect(result.email_addresses[0].verification?.status).toBe('verified')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/email_addresses'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('123456'),
        })
      )
    })

    it('should reject incorrect verification code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'verification_failed',
                message: 'Incorrect verification code',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.verifyEmail('user_test123', '000000')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Phone Verification Tests
// =============================================================================

describe('@dotdo/clerk - Phone Verification', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createPhoneVerification', () => {
    it('should create a phone verification and return code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          id: 'ver_phone123',
          code: '654321',
          expires_at: Date.now() + 600000,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createPhoneVerification('user_test123', '+15551234567')

      expect(result.id).toBe('ver_phone123')
      expect(result.code).toBe('654321')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/phone_numbers'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should throw error for phone not belonging to user', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Phone number not found for this user',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.createPhoneVerification('user_test123', '+19999999999')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('verifyPhone', () => {
    it('should verify phone with correct code', async () => {
      const userWithVerifiedPhone = mockUser({
        phone_numbers: [
          {
            id: 'idn_phone123',
            object: 'phone_number',
            phone_number: '+15551234567',
            reserved_for_second_factor: false,
            default_second_factor: false,
            verification: { status: 'verified', strategy: 'phone_code' },
            linked_to: [],
            created_at: Date.now() - 3600000,
            updated_at: Date.now(),
          },
        ],
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(userWithVerifiedPhone))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.verifyPhone('user_test123', '654321')

      expect(result.phone_numbers[0].verification?.status).toBe('verified')
    })

    it('should reject incorrect verification code', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'verification_failed',
                message: 'Incorrect verification code',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.verifyPhone('user_test123', '000000')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// External Account Management Tests
// =============================================================================

describe('@dotdo/clerk - External Accounts', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createExternalAccount', () => {
    it('should create an external account for a user', async () => {
      const externalAccount: ExternalAccount = {
        id: 'eac_test123',
        object: 'external_account',
        provider: 'google',
        identification_id: 'idn_google123',
        provider_user_id: 'google_user_12345',
        approved_scopes: 'email profile',
        email_address: 'user@gmail.com',
        first_name: 'Google',
        last_name: 'User',
        image_url: 'https://lh3.googleusercontent.com/a/default-user',
        username: null,
        public_metadata: {},
        label: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        verification: { status: 'verified', strategy: 'oauth_google' },
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(externalAccount))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createExternalAccount('user_test123', {
        provider: 'google',
        token: 'google_oauth_token',
        providerUserId: 'google_user_12345',
        email: 'user@gmail.com',
      })

      expect(result.id).toBe('eac_test123')
      expect(result.provider).toBe('google')
      expect(result.provider_user_id).toBe('google_user_12345')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/external_accounts'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should reject duplicate external account', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_identifier_exists',
                message: 'This external account is already linked',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.createExternalAccount('user_test123', {
          provider: 'github',
          token: 'github_token',
          providerUserId: 'github_123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteExternalAccount', () => {
    it('should delete an external account', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'external_account',
          id: 'eac_test123',
          deleted: true,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteExternalAccount('user_test123', 'eac_test123')

      expect(result.id).toBe('eac_test123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/external_accounts/eac_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should throw error for non-existent external account', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'External account not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.deleteExternalAccount('user_test123', 'eac_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('listExternalAccounts', () => {
    it('should list all external accounts for a user', async () => {
      const externalAccounts: ExternalAccount[] = [
        {
          id: 'eac_google123',
          object: 'external_account',
          provider: 'google',
          identification_id: 'idn_google123',
          provider_user_id: 'google_123',
          approved_scopes: 'email profile',
          email_address: 'user@gmail.com',
          first_name: 'User',
          last_name: 'Name',
          image_url: null,
          username: null,
          public_metadata: {},
          label: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          verification: { status: 'verified' },
        },
        {
          id: 'eac_github456',
          object: 'external_account',
          provider: 'github',
          identification_id: 'idn_github456',
          provider_user_id: 'github_456',
          approved_scopes: 'user:email',
          email_address: 'user@github.com',
          first_name: null,
          last_name: null,
          image_url: null,
          username: 'ghuser',
          public_metadata: {},
          label: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          verification: { status: 'verified' },
        },
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: externalAccounts,
          total_count: 2,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listExternalAccounts('user_test123')

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
      expect(result.data[0].provider).toBe('google')
      expect(result.data[1].provider).toBe('github')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/external_accounts'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return empty list for user with no external accounts', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listExternalAccounts('user_test123')

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })
})

// =============================================================================
// Password Management Tests
// =============================================================================

describe('@dotdo/clerk - Password Management', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('updatePassword', () => {
    it('should update user password', async () => {
      const updatedUser = mockUser({ password_enabled: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.updatePassword('user_test123', 'NewSecurePassword123!')

      expect(result.password_enabled).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123'),
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('NewSecurePassword123!'),
        })
      )
    })

    it('should reject weak password', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_password_pwned',
                message: 'Password has been found in an online data breach',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.updatePassword('user_test123', 'weak')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('resetPassword', () => {
    it('should generate password reset token', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          reset_token: 'rst_token123',
          expires_at: Date.now() + 3600000,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.resetPassword('user_test123')

      expect(result.reset_token).toBe('rst_token123')
      expect(result.expires_at).toBeGreaterThan(Date.now())
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/reset_password'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should throw 404 for non-existent user', async () => {
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
        // @ts-expect-error - Method not yet implemented
        clerk.users.resetPassword('user_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('checkPasswordStrength', () => {
    it('should return very_weak for short passwords', () => {
      // @ts-expect-error - Method not yet implemented
      const result = clerk.users.checkPasswordStrength('abc')

      expect(result.strength).toBe('very_weak')
      expect(result.score).toBeLessThanOrEqual(1)
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('should return weak for password without variety', () => {
      // @ts-expect-error - Method not yet implemented
      const result = clerk.users.checkPasswordStrength('abcdefgh')

      expect(result.strength).toBe('weak')
      expect(result.suggestions.length).toBeGreaterThan(0)
    })

    it('should return strong for good passwords', () => {
      // @ts-expect-error - Method not yet implemented
      const result = clerk.users.checkPasswordStrength('MyP@ssw0rd123!')

      expect(['strong', 'very_strong']).toContain(result.strength)
      expect(result.score).toBeGreaterThanOrEqual(5)
    })

    it('should return very_strong for excellent passwords', () => {
      // @ts-expect-error - Method not yet implemented
      const result = clerk.users.checkPasswordStrength('MyV3ryStr0ng&P@ssw0rd!')

      expect(result.strength).toBe('very_strong')
      expect(result.warnings).toHaveLength(0)
    })

    it('should warn about common patterns', () => {
      // @ts-expect-error - Method not yet implemented
      const result = clerk.users.checkPasswordStrength('password123')

      expect(result.warnings.some((w: string) => w.toLowerCase().includes('common'))).toBe(true)
    })
  })
})

// =============================================================================
// User Search and Lookup Tests
// =============================================================================

describe('@dotdo/clerk - User Search and Lookup', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('searchUsers', () => {
    it('should search users by query string', async () => {
      const users = [mockUser({ first_name: 'John', last_name: 'Doe' })]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: users,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.searchUsers('john')

      expect(result.data).toHaveLength(1)
      expect(result.data[0].first_name).toBe('John')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=john'),
        expect.anything()
      )
    })

    it('should return empty result for no matches', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.searchUsers('nonexistentuserxyz')

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })

  describe('getUserByEmail', () => {
    it('should get user by email address', async () => {
      const users = [
        mockUser({
          email_addresses: [
            {
              id: 'idn_test123',
              object: 'email_address',
              email_address: 'user@example.com',
              verification: { status: 'verified' },
              linked_to: [],
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
        }),
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: users,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByEmail('user@example.com')

      expect(result).not.toBeNull()
      expect(result?.email_addresses[0].email_address).toBe('user@example.com')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('email_address=user%40example.com'),
        expect.anything()
      )
    })

    it('should be case insensitive', async () => {
      const users = [mockUser()]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: users,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByEmail('USER@EXAMPLE.COM')

      expect(result).not.toBeNull()
    })

    it('should return null for non-existent email', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByEmail('nonexistent@example.com')

      expect(result).toBeNull()
    })
  })

  describe('getUserByExternalId', () => {
    it('should get user by external_id', async () => {
      const users = [mockUser({ external_id: 'ext_123' })]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: users,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByExternalId('ext_123')

      expect(result).not.toBeNull()
      expect(result?.external_id).toBe('ext_123')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('external_id=ext_123'),
        expect.anything()
      )
    })

    it('should return null for non-existent external_id', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByExternalId('nonexistent_ext_id')

      expect(result).toBeNull()
    })
  })

  describe('getUserByUsername', () => {
    it('should get user by username', async () => {
      const users = [mockUser({ username: 'johndoe' })]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: users,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByUsername('johndoe')

      expect(result).not.toBeNull()
      expect(result?.username).toBe('johndoe')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('username=johndoe'),
        expect.anything()
      )
    })

    it('should return null for non-existent username', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserByUsername('nonexistent_user')

      expect(result).toBeNull()
    })
  })
})

// =============================================================================
// User Metadata Retrieval Tests
// =============================================================================

describe('@dotdo/clerk - User Metadata Retrieval', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getUserMetadata', () => {
    it('should get all metadata types for a user', async () => {
      const user = mockUser({
        public_metadata: { role: 'admin' },
        private_metadata: { stripeId: 'cus_123' },
        unsafe_metadata: { theme: 'dark' },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(user))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserMetadata('user_test123')

      expect(result.publicMetadata).toEqual({ role: 'admin' })
      expect(result.privateMetadata).toEqual({ stripeId: 'cus_123' })
      expect(result.unsafeMetadata).toEqual({ theme: 'dark' })
    })

    it('should return empty objects for unset metadata', async () => {
      const user = mockUser({
        public_metadata: {},
        private_metadata: {},
        unsafe_metadata: {},
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(user))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserMetadata('user_test123')

      expect(result.publicMetadata).toEqual({})
      expect(result.privateMetadata).toEqual({})
      expect(result.unsafeMetadata).toEqual({})
    })

    it('should throw 404 for non-existent user', async () => {
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
        // @ts-expect-error - Method not yet implemented
        clerk.users.getUserMetadata('user_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// User Ban Status Tests
// =============================================================================

describe('@dotdo/clerk - User Ban Status', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isUserBanned', () => {
    it('should return banned status and reason', async () => {
      const bannedUser = mockUser({ banned: true })
      mockFetch.mockResolvedValueOnce(createMockResponse(bannedUser))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.isUserBanned('user_test123')

      expect(result.banned).toBe(true)
    })

    it('should return not banned for unbanned user', async () => {
      const unbannedUser = mockUser({ banned: false })
      mockFetch.mockResolvedValueOnce(createMockResponse(unbannedUser))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.isUserBanned('user_test123')

      expect(result.banned).toBe(false)
    })

    it('should throw 404 for non-existent user', async () => {
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
        // @ts-expect-error - Method not yet implemented
        clerk.users.isUserBanned('user_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Web3 Wallet Management Tests
// =============================================================================

describe('@dotdo/clerk - Web3 Wallet Management', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createWeb3Wallet', () => {
    it('should create a Web3 wallet for a user', async () => {
      const walletAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          id: 'w3w_test123',
          object: 'web3_wallet',
          web3_wallet: walletAddress,
          verification: { status: 'verified' },
          created_at: Date.now(),
          updated_at: Date.now(),
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createWeb3Wallet('user_test123', walletAddress)

      expect(result.id).toBe('w3w_test123')
      expect(result.web3_wallet).toBe(walletAddress)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/web3_wallets'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should reject invalid wallet address', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_format_invalid',
                message: 'Invalid wallet address format',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.createWeb3Wallet('user_test123', 'invalid_wallet')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteWeb3Wallet', () => {
    it('should delete a Web3 wallet', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'web3_wallet',
          id: 'w3w_test123',
          deleted: true,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteWeb3Wallet('user_test123', 'w3w_test123')

      expect(result.id).toBe('w3w_test123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/web3_wallets/w3w_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('listWeb3Wallets', () => {
    it('should list all Web3 wallets for a user', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [
            {
              id: 'w3w_test123',
              object: 'web3_wallet',
              web3_wallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
              verification: { status: 'verified' },
              created_at: Date.now(),
              updated_at: Date.now(),
            },
          ],
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listWeb3Wallets('user_test123')

      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/web3_wallets'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })
  })
})

// =============================================================================
// Profile Image Management Tests
// =============================================================================

describe('@dotdo/clerk - Profile Image Management', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('uploadProfileImage', () => {
    it('should upload a profile image for a user', async () => {
      const updatedUser = mockUser({
        has_image: true,
        image_url: 'https://img.clerk.com/new_image.png',
        profile_image_url: 'https://img.clerk.com/new_image.png',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      const imageFile = new File(['image data'], 'profile.png', { type: 'image/png' })

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.uploadProfileImage('user_test123', imageFile)

      expect(result.has_image).toBe(true)
      expect(result.image_url).toBe('https://img.clerk.com/new_image.png')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/profile_image'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should reject invalid image file', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_format_invalid',
                message: 'Invalid image format',
              },
            ],
          },
          422
        )
      )

      const textFile = new File(['not an image'], 'file.txt', { type: 'text/plain' })

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.uploadProfileImage('user_test123', textFile)
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteProfileImage', () => {
    it('should delete the profile image', async () => {
      const updatedUser = mockUser({
        has_image: false,
        image_url: 'https://img.clerk.com/default.png',
        profile_image_url: 'https://img.clerk.com/default.png',
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedUser))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteProfileImage('user_test123')

      expect(result.has_image).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/profile_image'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})
