/**
 * @dotdo/clerk - Clerk Invitations Compatibility Layer Tests
 *
 * Tests for Clerk Organization Invitations API compatibility.
 *
 * Tests cover the Clerk Backend API for organization invitations:
 * - Create invitation
 * - Get invitation
 * - List invitations
 * - Revoke invitation
 * - Bulk invitations
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Organization-Invitations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type OrganizationInvitation,
  type OrganizationInvitationList,
  type CreateOrganizationInvitationParams,
  type ListOrganizationInvitationsParams,
  type CreateBulkOrganizationInvitationsParams,
  type InvitationStatus,
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
 * Creates a mock organization invitation object
 */
function mockInvitation(overrides: Partial<OrganizationInvitation> = {}): OrganizationInvitation {
  const now = Date.now()
  return {
    id: 'inv_test123',
    object: 'organization_invitation',
    email_address: 'invite@example.com',
    organization_id: 'org_test123',
    public_metadata: {},
    private_metadata: {},
    role: 'basic_member',
    status: 'pending',
    created_at: now - 60 * 60 * 1000,
    updated_at: now,
    expires_at: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
    ...overrides,
  }
}

/**
 * Creates a mock invitation list response
 */
function mockInvitationList(
  invitations: OrganizationInvitation[],
  totalCount?: number
): OrganizationInvitationList {
  return {
    data: invitations,
    total_count: totalCount ?? invitations.length,
  }
}

// =============================================================================
// Invitations Resource Tests
// =============================================================================

describe('@dotdo/clerk - Invitations', () => {
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
  // Invitations Resource Exists
  // ===========================================================================

  describe('invitations resource', () => {
    it('should have invitations resource available', () => {
      expect(clerk.invitations).toBeDefined()
    })

    it('should have all invitation methods', () => {
      expect(clerk.invitations.createOrganizationInvitation).toBeDefined()
      expect(clerk.invitations.getOrganizationInvitation).toBeDefined()
      expect(clerk.invitations.listOrganizationInvitations).toBeDefined()
      expect(clerk.invitations.revokeOrganizationInvitation).toBeDefined()
      expect(clerk.invitations.getPendingInvitationsCount).toBeDefined()
      expect(clerk.invitations.createBulkOrganizationInvitations).toBeDefined()
    })
  })

  // ===========================================================================
  // Create Invitation
  // ===========================================================================

  describe('createOrganizationInvitation', () => {
    it('should create an invitation with required fields', async () => {
      const expectedInvitation = mockInvitation()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      const invitation = await clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'invite@example.com',
        role: 'basic_member',
        inviterUserId: 'user_admin123',
      })

      expect(invitation.id).toBe('inv_test123')
      expect(invitation.object).toBe('organization_invitation')
      expect(invitation.email_address).toBe('invite@example.com')
      expect(invitation.status).toBe('pending')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/invitations'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_xxx',
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should create an invitation with admin role', async () => {
      const expectedInvitation = mockInvitation({ role: 'admin' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      const invitation = await clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'admin@example.com',
        role: 'admin',
        inviterUserId: 'user_admin123',
      })

      expect(invitation.role).toBe('admin')
    })

    it('should create an invitation with redirect URL', async () => {
      const expectedInvitation = mockInvitation()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      await clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'invite@example.com',
        role: 'basic_member',
        inviterUserId: 'user_admin123',
        redirectUrl: 'https://example.com/welcome',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('redirect_url'),
        })
      )
    })

    it('should create an invitation with public metadata', async () => {
      const publicMetadata = { department: 'engineering', team: 'backend' }
      const expectedInvitation = mockInvitation({ public_metadata: publicMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      const invitation = await clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'invite@example.com',
        role: 'basic_member',
        inviterUserId: 'user_admin123',
        publicMetadata,
      })

      expect(invitation.public_metadata).toEqual(publicMetadata)
    })

    it('should create an invitation with private metadata', async () => {
      const privateMetadata = { inviteReason: 'referral', referredBy: 'john@example.com' }
      const expectedInvitation = mockInvitation({ private_metadata: privateMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      const invitation = await clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'invite@example.com',
        role: 'basic_member',
        inviterUserId: 'user_admin123',
        privateMetadata,
      })

      expect(invitation.private_metadata).toEqual(privateMetadata)
    })

    it('should handle duplicate invitation error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'duplicate_invitation',
            message: 'An invitation for this email already exists',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.invitations.createOrganizationInvitation('org_test123', {
          emailAddress: 'existing@example.com',
          role: 'basic_member',
          inviterUserId: 'user_admin123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle user already member error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'user_already_member',
            message: 'The invited user is already a member of this organization',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.invitations.createOrganizationInvitation('org_test123', {
          emailAddress: 'member@example.com',
          role: 'basic_member',
          inviterUserId: 'user_admin123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle organization not found error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'resource_not_found',
            message: 'Organization not found',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 404))

      await expect(
        clerk.invitations.createOrganizationInvitation('org_nonexistent', {
          emailAddress: 'invite@example.com',
          role: 'basic_member',
          inviterUserId: 'user_admin123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle inviter not authorized error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'inviter_not_authorized',
            message: 'The inviter does not have permission to invite users',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 403))

      await expect(
        clerk.invitations.createOrganizationInvitation('org_test123', {
          emailAddress: 'invite@example.com',
          role: 'basic_member',
          inviterUserId: 'user_basic123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Get Invitation
  // ===========================================================================

  describe('getOrganizationInvitation', () => {
    it('should retrieve an invitation by ID', async () => {
      const expectedInvitation = mockInvitation()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedInvitation))

      const invitation = await clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')

      expect(invitation.id).toBe('inv_test123')
      expect(invitation.object).toBe('organization_invitation')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/invitations/inv_test123'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return invitation with all fields populated', async () => {
      const fullInvitation = mockInvitation({
        public_metadata: { department: 'engineering' },
        private_metadata: { internal_notes: 'VIP candidate' },
        expires_at: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(fullInvitation))

      const invitation = await clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')

      expect(invitation.public_metadata).toEqual({ department: 'engineering' })
      expect(invitation.private_metadata).toEqual({ internal_notes: 'VIP candidate' })
      expect(invitation.expires_at).toBeDefined()
    })

    it('should handle invitation not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Invitation not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.invitations.getOrganizationInvitation('org_test123', 'inv_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should return accepted invitation', async () => {
      const acceptedInvitation = mockInvitation({ status: 'accepted' })
      mockFetch.mockResolvedValueOnce(createMockResponse(acceptedInvitation))

      const invitation = await clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')

      expect(invitation.status).toBe('accepted')
    })

    it('should return revoked invitation', async () => {
      const revokedInvitation = mockInvitation({ status: 'revoked' })
      mockFetch.mockResolvedValueOnce(createMockResponse(revokedInvitation))

      const invitation = await clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')

      expect(invitation.status).toBe('revoked')
    })

    it('should return expired invitation', async () => {
      const expiredInvitation = mockInvitation({
        status: 'expired',
        expires_at: Date.now() - 1000,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(expiredInvitation))

      const invitation = await clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')

      expect(invitation.status).toBe('expired')
    })
  })

  // ===========================================================================
  // List Invitations
  // ===========================================================================

  describe('listOrganizationInvitations', () => {
    it('should list all invitations', async () => {
      const invitations = [
        mockInvitation(),
        mockInvitation({ id: 'inv_test456', email_address: 'another@example.com' }),
      ]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123')

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })

    it('should filter invitations by pending status', async () => {
      const pendingInvitations = [mockInvitation({ status: 'pending' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(pendingInvitations)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123', {
        status: 'pending',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('pending')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('status=pending'),
        expect.anything()
      )
    })

    it('should filter invitations by accepted status', async () => {
      const acceptedInvitations = [mockInvitation({ status: 'accepted' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(acceptedInvitations)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123', {
        status: 'accepted',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('accepted')
    })

    it('should filter invitations by revoked status', async () => {
      const revokedInvitations = [mockInvitation({ status: 'revoked' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(revokedInvitations)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123', {
        status: 'revoked',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('revoked')
    })

    it('should support pagination with limit', async () => {
      const invitations = [mockInvitation()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations, 10)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123', {
        limit: 1,
      })

      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(10)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('limit=1'), expect.anything())
    })

    it('should support pagination with offset', async () => {
      const invitations = [mockInvitation({ id: 'inv_test456' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations, 10)))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123', {
        offset: 5,
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('offset=5'), expect.anything())
    })

    it('should return empty list when no invitations exist', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList([])))

      const result = await clerk.invitations.listOrganizationInvitations('org_test123')

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })

    it('should handle organization not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Organization not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.invitations.listOrganizationInvitations('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Revoke Invitation
  // ===========================================================================

  describe('revokeOrganizationInvitation', () => {
    it('should revoke an invitation', async () => {
      const revokedInvitation = mockInvitation({ status: 'revoked' })
      mockFetch.mockResolvedValueOnce(createMockResponse(revokedInvitation))

      const invitation = await clerk.invitations.revokeOrganizationInvitation(
        'org_test123',
        'inv_test123',
        'user_admin123'
      )

      expect(invitation.status).toBe('revoked')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/invitations/inv_test123/revoke'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('user_admin123'),
        })
      )
    })

    it('should handle invitation not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Invitation not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.invitations.revokeOrganizationInvitation('org_test123', 'inv_nonexistent', 'user_admin123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle already revoked invitation', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'invitation_already_revoked',
            message: 'Invitation has already been revoked',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 400))

      await expect(
        clerk.invitations.revokeOrganizationInvitation('org_test123', 'inv_test123', 'user_admin123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle accepted invitation (cannot revoke)', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'invitation_already_accepted',
            message: 'Cannot revoke an already accepted invitation',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 400))

      await expect(
        clerk.invitations.revokeOrganizationInvitation('org_test123', 'inv_accepted', 'user_admin123')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle requester not authorized error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'requester_not_authorized',
            message: 'The requesting user does not have permission to revoke invitations',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 403))

      await expect(
        clerk.invitations.revokeOrganizationInvitation('org_test123', 'inv_test123', 'user_basic123')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Get Pending Invitations Count
  // ===========================================================================

  describe('getPendingInvitationsCount', () => {
    it('should get pending invitations count', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'total_count',
          total_count: 5,
        })
      )

      const result = await clerk.invitations.getPendingInvitationsCount('org_test123')

      expect(result.total_count).toBe(5)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/invitations/pending_count'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return zero when no pending invitations', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          object: 'total_count',
          total_count: 0,
        })
      )

      const result = await clerk.invitations.getPendingInvitationsCount('org_test123')

      expect(result.total_count).toBe(0)
    })

    it('should handle organization not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Organization not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.invitations.getPendingInvitationsCount('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Bulk Invitations
  // ===========================================================================

  describe('createBulkOrganizationInvitations', () => {
    it('should create bulk invitations', async () => {
      const invitations = [
        mockInvitation({ email_address: 'user1@example.com' }),
        mockInvitation({ id: 'inv_test456', email_address: 'user2@example.com' }),
        mockInvitation({ id: 'inv_test789', email_address: 'user3@example.com' }),
      ]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations)))

      const result = await clerk.invitations.createBulkOrganizationInvitations('org_test123', {
        emailAddresses: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        role: 'basic_member',
        inviterUserId: 'user_admin123',
      })

      expect(result.data).toHaveLength(3)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/invitations/bulk'),
        expect.objectContaining({
          method: 'POST',
        })
      )
    })

    it('should create bulk invitations with metadata', async () => {
      const publicMetadata = { department: 'sales' }
      const invitations = [
        mockInvitation({ email_address: 'user1@example.com', public_metadata: publicMetadata }),
        mockInvitation({
          id: 'inv_test456',
          email_address: 'user2@example.com',
          public_metadata: publicMetadata,
        }),
      ]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations)))

      const result = await clerk.invitations.createBulkOrganizationInvitations('org_test123', {
        emailAddresses: ['user1@example.com', 'user2@example.com'],
        role: 'basic_member',
        inviterUserId: 'user_admin123',
        publicMetadata,
      })

      expect(result.data).toHaveLength(2)
      expect(result.data[0].public_metadata).toEqual(publicMetadata)
    })

    it('should create bulk invitations with redirect URL', async () => {
      const invitations = [mockInvitation()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockInvitationList(invitations)))

      await clerk.invitations.createBulkOrganizationInvitations('org_test123', {
        emailAddresses: ['user@example.com'],
        role: 'basic_member',
        inviterUserId: 'user_admin123',
        redirectUrl: 'https://example.com/onboard',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('redirect_url'),
        })
      )
    })

    it('should handle partial failure in bulk invitations', async () => {
      // Some invitations succeed, some fail (e.g., duplicates)
      const errorResponse = {
        errors: [
          {
            code: 'partial_failure',
            message: 'Some invitations could not be created',
            meta: {
              failed: ['existing@example.com'],
              succeeded: ['new1@example.com', 'new2@example.com'],
            },
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.invitations.createBulkOrganizationInvitations('org_test123', {
          emailAddresses: ['existing@example.com', 'new1@example.com', 'new2@example.com'],
          role: 'basic_member',
          inviterUserId: 'user_admin123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle organization not found error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'resource_not_found',
                message: 'Organization not found',
              },
            ],
          },
          404
        )
      )

      await expect(
        clerk.invitations.createBulkOrganizationInvitations('org_nonexistent', {
          emailAddresses: ['user@example.com'],
          role: 'basic_member',
          inviterUserId: 'user_admin123',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Invitation Types Tests
// =============================================================================

describe('@dotdo/clerk - Invitation Types', () => {
  it('should export OrganizationInvitation type', () => {
    const invitation: OrganizationInvitation = {
      id: 'inv_test123',
      object: 'organization_invitation',
      email_address: 'test@example.com',
      organization_id: 'org_test123',
      public_metadata: {},
      private_metadata: {},
      role: 'basic_member',
      status: 'pending',
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    expect(invitation.object).toBe('organization_invitation')
  })

  it('should export OrganizationInvitationList type', () => {
    const list: OrganizationInvitationList = {
      data: [],
      total_count: 0,
    }
    expect(list.total_count).toBe(0)
  })

  it('should export CreateOrganizationInvitationParams type', () => {
    const params: CreateOrganizationInvitationParams = {
      emailAddress: 'test@example.com',
      role: 'basic_member',
      inviterUserId: 'user_test123',
    }
    expect(params.emailAddress).toBe('test@example.com')
  })

  it('should export ListOrganizationInvitationsParams type', () => {
    const params: ListOrganizationInvitationsParams = {
      status: 'pending',
      limit: 10,
    }
    expect(params.status).toBe('pending')
  })

  it('should export InvitationStatus type', () => {
    const statuses: InvitationStatus[] = ['pending', 'accepted', 'revoked', 'expired']
    expect(statuses).toHaveLength(4)
  })
})

// =============================================================================
// Invitation Error Handling Tests
// =============================================================================

describe('@dotdo/clerk - Invitation Error Handling', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle rate limiting for invitation operations', async () => {
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

    await expect(
      clerk.invitations.listOrganizationInvitations('org_test123')
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle authentication errors for invitation operations', async () => {
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

    await expect(
      clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle server errors for invitation operations', async () => {
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
      clerk.invitations.createOrganizationInvitation('org_test123', {
        emailAddress: 'test@example.com',
        role: 'basic_member',
        inviterUserId: 'user_test123',
      })
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle network errors for invitation operations', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      clerk.invitations.getOrganizationInvitation('org_test123', 'inv_test123')
    ).rejects.toThrow('Network error')
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

    await expect(
      clerk.invitations.revokeOrganizationInvitation('org_test123', 'inv_test123', 'user_basic123')
    ).rejects.toThrow(ClerkAPIError)
  })
})
