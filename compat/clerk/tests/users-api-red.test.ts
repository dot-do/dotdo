/**
 * @dotdo/clerk - Clerk Users API RED Phase Tests
 *
 * These tests are designed to FAIL and document features that need to be implemented.
 * This is the RED phase of TDD - tests should fail until the implementation is complete.
 *
 * Features to implement:
 * - OAuth access token retrieval (getUserOauthAccessToken)
 * - User passkey management (createPasskey, deletePasskey, listPasskeys)
 * - Email address management (addEmailAddress, deleteEmailAddress)
 * - Phone number management (addPhoneNumber, deletePhoneNumber)
 * - User merge/link accounts
 * - User activity tracking (getUserActivity)
 * - Sign-in attempts (getSignInAttempts)
 * - User deletion scheduling (scheduleUserDeletion, cancelUserDeletion)
 * - Backup codes management (createBackupCodes, listBackupCodes)
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type User,
  type DeletedObject,
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
// OAuth Access Token Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - OAuth Access Token [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getUserOauthAccessToken', () => {
    it('should retrieve OAuth access token for a user and provider', async () => {
      const oauthTokenResponse = {
        object: 'oauth_access_token',
        token: 'ya29.access_token_xxx',
        provider: 'google',
        scopes: ['email', 'profile', 'openid'],
        expires_at: Date.now() + 3600000,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse([oauthTokenResponse]))

      // This method does NOT exist yet - should fail
      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserOauthAccessToken('user_test123', 'google')

      expect(result).toBeDefined()
      expect(result[0].token).toBe('ya29.access_token_xxx')
      expect(result[0].provider).toBe('google')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/oauth_access_tokens/google'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should retrieve OAuth access token with custom provider prefix', async () => {
      const oauthTokenResponse = {
        object: 'oauth_access_token',
        token: 'custom_token_xxx',
        provider: 'custom_myoauth',
        scopes: ['read', 'write'],
        expires_at: Date.now() + 3600000,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse([oauthTokenResponse]))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserOauthAccessToken('user_test123', 'custom_myoauth')

      expect(result[0].provider).toBe('custom_myoauth')
    })

    it('should return empty array when no OAuth token exists for provider', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse([]))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserOauthAccessToken('user_test123', 'github')

      expect(result).toEqual([])
    })

    it('should throw error for user without OAuth connection', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'User does not have a connected account for this provider',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.getUserOauthAccessToken('user_test123', 'twitter')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle expired OAuth tokens', async () => {
      const expiredTokenResponse = {
        object: 'oauth_access_token',
        token: null,
        provider: 'google',
        scopes: [],
        expires_at: Date.now() - 3600000, // Expired 1 hour ago
        error: 'token_expired',
      }
      mockFetch.mockResolvedValueOnce(createMockResponse([expiredTokenResponse]))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserOauthAccessToken('user_test123', 'google')

      expect(result[0].error).toBe('token_expired')
    })
  })
})

// =============================================================================
// Passkey Management Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - Passkey Management [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listPasskeys', () => {
    it('should list all passkeys for a user', async () => {
      const passkeys = [
        {
          id: 'pk_test123',
          object: 'passkey',
          name: 'MacBook Pro Touch ID',
          credential_id: 'cred_xxx',
          last_used_at: Date.now() - 3600000,
          created_at: Date.now() - 86400000,
          updated_at: Date.now(),
        },
        {
          id: 'pk_test456',
          object: 'passkey',
          name: 'YubiKey 5',
          credential_id: 'cred_yyy',
          last_used_at: null,
          created_at: Date.now() - 172800000,
          updated_at: Date.now(),
        },
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: passkeys,
          total_count: 2,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listPasskeys('user_test123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].name).toBe('MacBook Pro Touch ID')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/passkeys'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return empty list for user without passkeys', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 0,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listPasskeys('user_test123')

      expect(result.data).toHaveLength(0)
    })
  })

  describe('deletePasskey', () => {
    it('should delete a passkey for a user', async () => {
      const deletedPasskey = {
        object: 'passkey',
        id: 'pk_test123',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedPasskey))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deletePasskey('user_test123', 'pk_test123')

      expect(result.id).toBe('pk_test123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/passkeys/pk_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should throw error for non-existent passkey', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Passkey not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.deletePasskey('user_test123', 'pk_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Email Address Management Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - Email Address Management [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('addEmailAddress', () => {
    it('should add an email address to a user', async () => {
      const emailAddress = {
        id: 'idn_new123',
        object: 'email_address',
        email_address: 'newemail@example.com',
        verification: { status: 'unverified' },
        linked_to: [],
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(emailAddress))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.addEmailAddress('user_test123', 'newemail@example.com')

      expect(result.id).toBe('idn_new123')
      expect(result.email_address).toBe('newemail@example.com')
      expect(result.verification.status).toBe('unverified')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/email_addresses'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('newemail@example.com'),
        })
      )
    })

    it('should reject duplicate email address', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_identifier_exists',
                message: 'That email address is taken. Please try another.',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.addEmailAddress('user_test123', 'existing@example.com')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject invalid email format', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_format_invalid',
                message: 'Invalid email address format',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.addEmailAddress('user_test123', 'not-an-email')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteEmailAddress', () => {
    it('should delete an email address from a user', async () => {
      const deletedEmail = {
        object: 'email_address',
        id: 'idn_test123',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedEmail))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteEmailAddress('user_test123', 'idn_test123')

      expect(result.id).toBe('idn_test123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/email_addresses/idn_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should reject deleting primary email address', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_value_invalid',
                message: 'Cannot delete primary email address',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.deleteEmailAddress('user_test123', 'idn_primary123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should reject deleting last remaining email address', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_value_invalid',
                message: 'User must have at least one email address',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.deleteEmailAddress('user_test123', 'idn_last123')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('listEmailAddresses', () => {
    it('should list all email addresses for a user', async () => {
      const emailAddresses = [
        {
          id: 'idn_test123',
          object: 'email_address',
          email_address: 'primary@example.com',
          verification: { status: 'verified' },
          linked_to: [],
          created_at: Date.now() - 86400000,
          updated_at: Date.now(),
        },
        {
          id: 'idn_test456',
          object: 'email_address',
          email_address: 'secondary@example.com',
          verification: { status: 'verified' },
          linked_to: [],
          created_at: Date.now() - 3600000,
          updated_at: Date.now(),
        },
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: emailAddresses,
          total_count: 2,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listEmailAddresses('user_test123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].email_address).toBe('primary@example.com')
    })
  })
})

// =============================================================================
// Phone Number Management Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - Phone Number Management [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('addPhoneNumber', () => {
    it('should add a phone number to a user', async () => {
      const phoneNumber = {
        id: 'idn_phone_new123',
        object: 'phone_number',
        phone_number: '+15559876543',
        reserved_for_second_factor: false,
        default_second_factor: false,
        verification: { status: 'unverified' },
        linked_to: [],
        created_at: Date.now(),
        updated_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(phoneNumber))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.addPhoneNumber('user_test123', '+15559876543')

      expect(result.id).toBe('idn_phone_new123')
      expect(result.phone_number).toBe('+15559876543')
      expect(result.verification.status).toBe('unverified')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/phone_numbers'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should reject invalid phone number format', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_format_invalid',
                message: 'Invalid phone number format',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.addPhoneNumber('user_test123', '123-invalid')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deletePhoneNumber', () => {
    it('should delete a phone number from a user', async () => {
      const deletedPhone = {
        object: 'phone_number',
        id: 'idn_phone123',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedPhone))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deletePhoneNumber('user_test123', 'idn_phone123')

      expect(result.id).toBe('idn_phone123')
      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/phone_numbers/idn_phone123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('listPhoneNumbers', () => {
    it('should list all phone numbers for a user', async () => {
      const phoneNumbers = [
        {
          id: 'idn_phone123',
          object: 'phone_number',
          phone_number: '+15551234567',
          reserved_for_second_factor: false,
          default_second_factor: false,
          verification: { status: 'verified' },
          linked_to: [],
          created_at: Date.now() - 86400000,
          updated_at: Date.now(),
        },
      ]
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: phoneNumbers,
          total_count: 1,
        })
      )

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listPhoneNumbers('user_test123')

      expect(result.data).toHaveLength(1)
      expect(result.data[0].phone_number).toBe('+15551234567')
    })
  })
})

// =============================================================================
// User Activity Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - User Activity [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getUserActivity', () => {
    it('should get user activity logs', async () => {
      const activityLogs = {
        data: [
          {
            id: 'act_test123',
            object: 'activity',
            action: 'sign_in',
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            location: { city: 'San Francisco', country: 'US' },
            created_at: Date.now() - 3600000,
          },
          {
            id: 'act_test456',
            object: 'activity',
            action: 'password_change',
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            location: { city: 'San Francisco', country: 'US' },
            created_at: Date.now() - 7200000,
          },
        ],
        total_count: 2,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(activityLogs))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserActivity('user_test123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].action).toBe('sign_in')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/activity'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should filter activity by action type', async () => {
      const activityLogs = {
        data: [
          {
            id: 'act_test123',
            object: 'activity',
            action: 'sign_in',
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            location: { city: 'San Francisco', country: 'US' },
            created_at: Date.now() - 3600000,
          },
        ],
        total_count: 1,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(activityLogs))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getUserActivity('user_test123', { action: 'sign_in' })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].action).toBe('sign_in')
    })

    it('should support pagination for activity logs', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          data: [],
          total_count: 100,
        })
      )

      // @ts-expect-error - Method not yet implemented
      await clerk.users.getUserActivity('user_test123', { limit: 10, offset: 50 })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.anything()
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=50'),
        expect.anything()
      )
    })
  })
})

// =============================================================================
// Backup Codes Management Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - Backup Codes Management [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createBackupCodes', () => {
    it('should create backup codes for a user', async () => {
      const backupCodesResponse = {
        object: 'backup_codes',
        codes: [
          'ABC123DEF456',
          'GHI789JKL012',
          'MNO345PQR678',
          'STU901VWX234',
          'YZA567BCD890',
          'EFG123HIJ456',
          'KLM789NOP012',
          'QRS345TUV678',
          'WXY901ZAB234',
          'CDE567FGH890',
        ],
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(backupCodesResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createBackupCodes('user_test123')

      expect(result.codes).toHaveLength(10)
      expect(result.codes[0]).toBe('ABC123DEF456')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/backup_codes'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should replace existing backup codes when regenerating', async () => {
      const newBackupCodesResponse = {
        object: 'backup_codes',
        codes: ['NEW123ABC456', 'NEW789DEF012'],
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(newBackupCodesResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createBackupCodes('user_test123', { regenerate: true })

      expect(result.codes).toBeDefined()
    })
  })

  describe('listBackupCodes', () => {
    it('should list backup code status for a user', async () => {
      const backupCodeStatus = {
        object: 'backup_codes',
        codes_remaining: 8,
        codes_used: 2,
        created_at: Date.now() - 86400000,
        updated_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(backupCodeStatus))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.listBackupCodes('user_test123')

      expect(result.codes_remaining).toBe(8)
      expect(result.codes_used).toBe(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/backup_codes'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return null when no backup codes exist', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'No backup codes found for this user',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.listBackupCodes('user_test123')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteBackupCodes', () => {
    it('should delete all backup codes for a user', async () => {
      const deletedBackupCodes = {
        object: 'backup_codes',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedBackupCodes))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteBackupCodes('user_test123')

      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/backup_codes'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})

// =============================================================================
// User Deletion Scheduling Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - User Deletion Scheduling [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('scheduleUserDeletion', () => {
    it('should schedule a user for deletion', async () => {
      const scheduledDeletionResponse = {
        object: 'scheduled_deletion',
        user_id: 'user_test123',
        scheduled_at: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days from now
        status: 'pending',
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(scheduledDeletionResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.scheduleUserDeletion('user_test123', {
        daysUntilDeletion: 30,
      })

      expect(result.user_id).toBe('user_test123')
      expect(result.status).toBe('pending')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/schedule_deletion'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should support immediate deletion scheduling', async () => {
      const scheduledDeletionResponse = {
        object: 'scheduled_deletion',
        user_id: 'user_test123',
        scheduled_at: Date.now(),
        status: 'processing',
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(scheduledDeletionResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.scheduleUserDeletion('user_test123', {
        daysUntilDeletion: 0,
      })

      expect(result.status).toBe('processing')
    })
  })

  describe('cancelUserDeletion', () => {
    it('should cancel a scheduled user deletion', async () => {
      const cancelledDeletionResponse = {
        object: 'scheduled_deletion',
        user_id: 'user_test123',
        status: 'cancelled',
        cancelled_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(cancelledDeletionResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.cancelUserDeletion('user_test123')

      expect(result.status).toBe('cancelled')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/cancel_deletion'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should throw error when no scheduled deletion exists', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'No scheduled deletion found for this user',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.cancelUserDeletion('user_test123')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('getScheduledDeletion', () => {
    it('should get scheduled deletion status for a user', async () => {
      const scheduledDeletionResponse = {
        object: 'scheduled_deletion',
        user_id: 'user_test123',
        scheduled_at: Date.now() + 15 * 24 * 60 * 60 * 1000, // 15 days remaining
        status: 'pending',
        created_at: Date.now() - 15 * 24 * 60 * 60 * 1000,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(scheduledDeletionResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getScheduledDeletion('user_test123')

      expect(result.user_id).toBe('user_test123')
      expect(result.status).toBe('pending')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/scheduled_deletion'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })
  })
})

// =============================================================================
// User Account Linking Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - User Account Linking [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('mergeUsers', () => {
    it('should merge two user accounts', async () => {
      const mergedUser = mockUser({
        id: 'user_primary123',
        email_addresses: [
          {
            id: 'idn_test123',
            object: 'email_address',
            email_address: 'primary@example.com',
            verification: { status: 'verified' },
            linked_to: [],
            created_at: Date.now(),
            updated_at: Date.now(),
          },
          {
            id: 'idn_test456',
            object: 'email_address',
            email_address: 'secondary@example.com',
            verification: { status: 'verified' },
            linked_to: [],
            created_at: Date.now(),
            updated_at: Date.now(),
          },
        ],
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(mergedUser))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.mergeUsers('user_primary123', 'user_secondary456')

      expect(result.id).toBe('user_primary123')
      expect(result.email_addresses).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_primary123/merge'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('user_secondary456'),
        })
      )
    })

    it('should throw error when merging same user', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_value_invalid',
                message: 'Cannot merge a user with themselves',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.mergeUsers('user_test123', 'user_test123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should throw error when secondary user not found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Secondary user not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.mergeUsers('user_test123', 'user_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// TOTP Management Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - TOTP Management [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createTOTP', () => {
    it('should create TOTP enrollment for a user', async () => {
      const totpResponse = {
        object: 'totp',
        secret: 'JBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example',
        backup_codes: [
          'ABC123DEF456',
          'GHI789JKL012',
        ],
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(totpResponse))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createTOTP('user_test123')

      expect(result.secret).toBe('JBSWY3DPEHPK3PXP')
      expect(result.uri).toContain('otpauth://totp')
      expect(result.backup_codes).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/totp'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should throw error when TOTP already enabled', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'form_param_value_invalid',
                message: 'TOTP is already enabled for this user',
              },
            ],
          },
          422
        )
      )

      await expect(
        // @ts-expect-error - Method not yet implemented
        clerk.users.createTOTP('user_test123')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteTOTP', () => {
    it('should delete TOTP for a user', async () => {
      const deletedTOTP = {
        object: 'totp',
        deleted: true,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedTOTP))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.deleteTOTP('user_test123')

      expect(result.deleted).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/totp'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })
})

// =============================================================================
// Sign-In Attempts Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - Sign-In Attempts [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getSignInAttempts', () => {
    it('should get sign-in attempts for a user', async () => {
      const signInAttempts = {
        data: [
          {
            id: 'sia_test123',
            object: 'sign_in_attempt',
            status: 'complete',
            identifier: 'user@example.com',
            ip_address: '192.168.1.1',
            user_agent: 'Mozilla/5.0',
            created_at: Date.now() - 3600000,
          },
          {
            id: 'sia_test456',
            object: 'sign_in_attempt',
            status: 'failed',
            identifier: 'user@example.com',
            ip_address: '192.168.1.100',
            user_agent: 'Unknown',
            error: 'invalid_password',
            created_at: Date.now() - 7200000,
          },
        ],
        total_count: 2,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(signInAttempts))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getSignInAttempts('user_test123')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].status).toBe('complete')
      expect(result.data[1].status).toBe('failed')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/sign_in_attempts'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should filter sign-in attempts by status', async () => {
      const signInAttempts = {
        data: [
          {
            id: 'sia_test456',
            object: 'sign_in_attempt',
            status: 'failed',
            identifier: 'user@example.com',
            ip_address: '192.168.1.100',
            user_agent: 'Unknown',
            error: 'invalid_password',
            created_at: Date.now() - 7200000,
          },
        ],
        total_count: 1,
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(signInAttempts))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.getSignInAttempts('user_test123', { status: 'failed' })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('failed')
    })
  })
})

// =============================================================================
// Impersonation Tests (NOT IMPLEMENTED)
// =============================================================================

describe('@dotdo/clerk - User Impersonation [RED]', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createImpersonationToken', () => {
    it('should create an impersonation token for a user', async () => {
      const impersonationToken = {
        object: 'impersonation_token',
        token: 'imp_token_xxx',
        user_id: 'user_test123',
        expires_at: Date.now() + 3600000,
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(impersonationToken))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createImpersonationToken('user_test123')

      expect(result.token).toBe('imp_token_xxx')
      expect(result.user_id).toBe('user_test123')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/users/user_test123/impersonation_token'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should support custom expiration', async () => {
      const impersonationToken = {
        object: 'impersonation_token',
        token: 'imp_token_xxx',
        user_id: 'user_test123',
        expires_at: Date.now() + 7200000, // 2 hours
        created_at: Date.now(),
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(impersonationToken))

      // @ts-expect-error - Method not yet implemented
      const result = await clerk.users.createImpersonationToken('user_test123', {
        expiresInSeconds: 7200,
      })

      expect(result.expires_at).toBeGreaterThan(Date.now() + 3600000)
    })

    it('should throw error for non-existent user', async () => {
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
        clerk.users.createImpersonationToken('user_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})
