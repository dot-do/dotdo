/**
 * @dotdo/clerk - Clerk Organizations Compatibility Layer Tests
 *
 * RED Phase TDD tests for Clerk Organizations API compatibility.
 * These tests should FAIL because the Organizations implementation doesn't exist yet.
 *
 * Tests cover the Clerk Backend API for organizations:
 * - Create organization
 * - Get organization
 * - Update organization
 * - Delete organization
 * - List organizations
 * - Organization metadata
 * - Organization slug management
 * - Organization logo management
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Organizations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Clerk,
  ClerkAPIError,
  type Organization,
  type OrganizationList,
  type CreateOrganizationParams,
  type UpdateOrganizationParams,
  type ListOrganizationsParams,
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
 * Creates a mock Clerk organization object matching the Clerk API response format
 */
function mockOrganization(overrides: Partial<Organization> = {}): Organization {
  const now = Date.now()
  return {
    id: 'org_test123',
    object: 'organization',
    name: 'Test Organization',
    slug: 'test-organization',
    image_url: null,
    has_image: false,
    members_count: 1,
    pending_invitations_count: 0,
    max_allowed_memberships: 5,
    admin_delete_enabled: true,
    public_metadata: {},
    private_metadata: {},
    created_by: 'user_test123',
    created_at: now - 60 * 60 * 1000, // 1 hour ago
    updated_at: now,
    ...overrides,
  }
}

/**
 * Creates a mock Clerk organization list response
 */
function mockOrganizationList(organizations: Organization[], totalCount?: number): OrganizationList {
  return {
    data: organizations,
    total_count: totalCount ?? organizations.length,
  }
}

// =============================================================================
// Organization Resource Tests - These will FAIL (RED phase)
// =============================================================================

describe('@dotdo/clerk - Organizations', () => {
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
  // Organizations Resource Exists
  // ===========================================================================

  describe('organizations resource', () => {
    it('should have organizations resource available', () => {
      // This test will FAIL because clerk.organizations doesn't exist
      expect(clerk.organizations).toBeDefined()
    })

    it('should have all organization methods', () => {
      // These tests will FAIL because the methods don't exist
      expect(clerk.organizations.createOrganization).toBeDefined()
      expect(clerk.organizations.getOrganization).toBeDefined()
      expect(clerk.organizations.updateOrganization).toBeDefined()
      expect(clerk.organizations.deleteOrganization).toBeDefined()
      expect(clerk.organizations.listOrganizations).toBeDefined()
      expect(clerk.organizations.updateOrganizationMetadata).toBeDefined()
      expect(clerk.organizations.updateOrganizationLogo).toBeDefined()
      expect(clerk.organizations.deleteOrganizationLogo).toBeDefined()
    })
  })

  // ===========================================================================
  // Create Organization
  // ===========================================================================

  describe('createOrganization', () => {
    it('should create an organization with name', async () => {
      const expectedOrg = mockOrganization()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
      })

      expect(org.id).toBe('org_test123')
      expect(org.name).toBe('Test Organization')
      expect(org.object).toBe('organization')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test_xxx',
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should create an organization with slug', async () => {
      const expectedOrg = mockOrganization({ slug: 'my-custom-slug' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
        slug: 'my-custom-slug',
      })

      expect(org.slug).toBe('my-custom-slug')
    })

    it('should create an organization with created_by user', async () => {
      const expectedOrg = mockOrganization({ created_by: 'user_admin123' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
        createdBy: 'user_admin123',
      })

      expect(org.created_by).toBe('user_admin123')
    })

    it('should create an organization with max_allowed_memberships', async () => {
      const expectedOrg = mockOrganization({ max_allowed_memberships: 100 })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
        maxAllowedMemberships: 100,
      })

      expect(org.max_allowed_memberships).toBe(100)
    })

    it('should create an organization with public metadata', async () => {
      const publicMetadata = { industry: 'tech', size: 'enterprise' }
      const expectedOrg = mockOrganization({ public_metadata: publicMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
        publicMetadata,
      })

      expect(org.public_metadata).toEqual(publicMetadata)
    })

    it('should create an organization with private metadata', async () => {
      const privateMetadata = { stripe_customer_id: 'cus_xxx', internal_id: '12345' }
      const expectedOrg = mockOrganization({ private_metadata: privateMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.createOrganization({
        name: 'Test Organization',
        privateMetadata,
      })

      expect(org.private_metadata).toEqual(privateMetadata)
    })

    it('should handle duplicate slug error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'slug_already_exists',
            message: 'Organization slug already exists',
            long_message: 'An organization with this slug already exists. Please choose a different slug.',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.organizations.createOrganization({
          name: 'Test Organization',
          slug: 'existing-slug',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle name too short error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'form_param_value_too_short',
            message: 'Name is too short',
            meta: { param_name: 'name', min_length: 1 },
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 422))

      await expect(
        clerk.organizations.createOrganization({
          name: '',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle invalid created_by user error', async () => {
      const errorResponse = {
        errors: [
          {
            code: 'resource_not_found',
            message: 'User not found',
          },
        ],
      }
      mockFetch.mockResolvedValueOnce(createMockResponse(errorResponse, 404))

      await expect(
        clerk.organizations.createOrganization({
          name: 'Test Organization',
          createdBy: 'user_nonexistent',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Get Organization
  // ===========================================================================

  describe('getOrganization', () => {
    it('should retrieve an organization by ID', async () => {
      const expectedOrg = mockOrganization()
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.getOrganization('org_test123')

      expect(org.id).toBe('org_test123')
      expect(org.object).toBe('organization')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123'),
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should retrieve an organization by slug', async () => {
      const expectedOrg = mockOrganization({ slug: 'test-slug' })
      mockFetch.mockResolvedValueOnce(createMockResponse(expectedOrg))

      const org = await clerk.organizations.getOrganization({ slug: 'test-slug' })

      expect(org.slug).toBe('test-slug')
    })

    it('should return organization with all fields populated', async () => {
      const fullOrg = mockOrganization({
        image_url: 'https://img.clerk.com/org_xxx.png',
        has_image: true,
        members_count: 25,
        pending_invitations_count: 3,
        max_allowed_memberships: 100,
        admin_delete_enabled: false,
        public_metadata: { plan: 'enterprise' },
        private_metadata: { internal_notes: 'VIP customer' },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(fullOrg))

      const org = await clerk.organizations.getOrganization('org_test123')

      expect(org.image_url).toBe('https://img.clerk.com/org_xxx.png')
      expect(org.has_image).toBe(true)
      expect(org.members_count).toBe(25)
      expect(org.pending_invitations_count).toBe(3)
      expect(org.max_allowed_memberships).toBe(100)
      expect(org.admin_delete_enabled).toBe(false)
      expect(org.public_metadata).toEqual({ plan: 'enterprise' })
      expect(org.private_metadata).toEqual({ internal_notes: 'VIP customer' })
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
        clerk.organizations.getOrganization('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle invalid organization ID format', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'invalid_identifier',
                message: 'Invalid organization identifier',
              },
            ],
          },
          400
        )
      )

      await expect(
        clerk.organizations.getOrganization('invalid-id-format')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Update Organization
  // ===========================================================================

  describe('updateOrganization', () => {
    it('should update organization name', async () => {
      const updatedOrg = mockOrganization({ name: 'Updated Organization Name' })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        name: 'Updated Organization Name',
      })

      expect(org.name).toBe('Updated Organization Name')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
    })

    it('should update organization slug', async () => {
      const updatedOrg = mockOrganization({ slug: 'new-slug' })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        slug: 'new-slug',
      })

      expect(org.slug).toBe('new-slug')
    })

    it('should update max_allowed_memberships', async () => {
      const updatedOrg = mockOrganization({ max_allowed_memberships: 50 })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        maxAllowedMemberships: 50,
      })

      expect(org.max_allowed_memberships).toBe(50)
    })

    it('should update admin_delete_enabled', async () => {
      const updatedOrg = mockOrganization({ admin_delete_enabled: false })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        adminDeleteEnabled: false,
      })

      expect(org.admin_delete_enabled).toBe(false)
    })

    it('should update public metadata', async () => {
      const publicMetadata = { plan: 'pro', features: ['sso', 'audit-logs'] }
      const updatedOrg = mockOrganization({ public_metadata: publicMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        publicMetadata,
      })

      expect(org.public_metadata).toEqual(publicMetadata)
    })

    it('should update private metadata', async () => {
      const privateMetadata = { billing_tier: 'premium', account_manager: 'john@company.com' }
      const updatedOrg = mockOrganization({ private_metadata: privateMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganization('org_test123', {
        privateMetadata,
      })

      expect(org.private_metadata).toEqual(privateMetadata)
    })

    it('should handle slug conflict on update', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'slug_already_exists',
                message: 'Organization slug already exists',
              },
            ],
          },
          422
        )
      )

      await expect(
        clerk.organizations.updateOrganization('org_test123', {
          slug: 'existing-slug',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle organization not found on update', async () => {
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
        clerk.organizations.updateOrganization('org_nonexistent', {
          name: 'New Name',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Delete Organization
  // ===========================================================================

  describe('deleteOrganization', () => {
    it('should delete an organization by ID', async () => {
      const deletedOrg = mockOrganization()
      mockFetch.mockResolvedValueOnce(createMockResponse(deletedOrg))

      const org = await clerk.organizations.deleteOrganization('org_test123')

      expect(org.id).toBe('org_test123')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should handle organization not found on delete', async () => {
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
        clerk.organizations.deleteOrganization('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle admin delete disabled error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'organization_delete_disabled',
                message: 'Organization deletion is disabled',
                long_message: 'Admin deletion has been disabled for this organization.',
              },
            ],
          },
          403
        )
      )

      await expect(
        clerk.organizations.deleteOrganization('org_protected')
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle organization with active members error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'organization_has_members',
                message: 'Organization has active members',
                long_message: 'Cannot delete organization with active members. Remove all members first.',
              },
            ],
          },
          409
        )
      )

      await expect(
        clerk.organizations.deleteOrganization('org_with_members')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // List Organizations
  // ===========================================================================

  describe('listOrganizations', () => {
    it('should list all organizations', async () => {
      const orgs = [
        mockOrganization(),
        mockOrganization({ id: 'org_test456', name: 'Another Org', slug: 'another-org' }),
      ]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations()

      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
    })

    it('should filter organizations by user_id', async () => {
      const orgs = [mockOrganization()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations({
        userId: 'user_test123',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user_id=user_test123'),
        expect.anything()
      )
    })

    it('should filter organizations by include_members_count', async () => {
      const orgs = [mockOrganization({ members_count: 5 })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations({
        includeMembersCount: true,
      })

      expect(result.data[0].members_count).toBe(5)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('include_members_count=true'),
        expect.anything()
      )
    })

    it('should support pagination with limit', async () => {
      const orgs = [mockOrganization()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs, 10)))

      const result = await clerk.organizations.listOrganizations({
        limit: 1,
      })

      expect(result.data).toHaveLength(1)
      expect(result.total_count).toBe(10)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=1'),
        expect.anything()
      )
    })

    it('should support pagination with offset', async () => {
      const orgs = [mockOrganization({ id: 'org_test456' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs, 10)))

      const result = await clerk.organizations.listOrganizations({
        offset: 5,
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=5'),
        expect.anything()
      )
    })

    it('should order organizations by name ascending', async () => {
      const orgs = [
        mockOrganization({ name: 'Alpha Corp' }),
        mockOrganization({ id: 'org_test456', name: 'Beta Inc' }),
      ]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations({
        orderBy: 'name',
      })

      expect(result.data[0].name).toBe('Alpha Corp')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('order_by=name'),
        expect.anything()
      )
    })

    it('should order organizations by created_at descending', async () => {
      const orgs = [mockOrganization()]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations({
        orderBy: '-created_at',
      })

      expect(result.data).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('order_by=-created_at'),
        expect.anything()
      )
    })

    it('should filter by query string (search)', async () => {
      const orgs = [mockOrganization({ name: 'Acme Corporation' })]
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList(orgs)))

      const result = await clerk.organizations.listOrganizations({
        query: 'acme',
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].name).toContain('Acme')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('query=acme'),
        expect.anything()
      )
    })

    it('should return empty list when no organizations exist', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(mockOrganizationList([])))

      const result = await clerk.organizations.listOrganizations()

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })

  // ===========================================================================
  // Update Organization Metadata
  // ===========================================================================

  describe('updateOrganizationMetadata', () => {
    it('should update public metadata', async () => {
      const publicMetadata = { tier: 'enterprise', industry: 'fintech' }
      const updatedOrg = mockOrganization({ public_metadata: publicMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganizationMetadata('org_test123', {
        publicMetadata,
      })

      expect(org.public_metadata).toEqual(publicMetadata)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/metadata'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
    })

    it('should update private metadata', async () => {
      const privateMetadata = { stripe_id: 'cus_xxx', internal_notes: 'Priority support' }
      const updatedOrg = mockOrganization({ private_metadata: privateMetadata })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganizationMetadata('org_test123', {
        privateMetadata,
      })

      expect(org.private_metadata).toEqual(privateMetadata)
    })

    it('should merge metadata with existing values', async () => {
      const existingOrg = mockOrganization({
        public_metadata: { existing: 'value' },
        private_metadata: { secret: 'data' },
      })
      const updatedOrg = mockOrganization({
        public_metadata: { existing: 'value', new: 'field' },
        private_metadata: { secret: 'data', another: 'secret' },
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.updateOrganizationMetadata('org_test123', {
        publicMetadata: { new: 'field' },
        privateMetadata: { another: 'secret' },
      })

      expect(org.public_metadata).toEqual({ existing: 'value', new: 'field' })
      expect(org.private_metadata).toEqual({ secret: 'data', another: 'secret' })
    })

    it('should handle organization not found', async () => {
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
        clerk.organizations.updateOrganizationMetadata('org_nonexistent', {
          publicMetadata: { foo: 'bar' },
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle invalid metadata format', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'invalid_metadata',
                message: 'Metadata must be a valid JSON object',
              },
            ],
          },
          422
        )
      )

      await expect(
        clerk.organizations.updateOrganizationMetadata('org_test123', {
          publicMetadata: 'invalid' as unknown as Record<string, unknown>,
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ===========================================================================
  // Organization Logo Management
  // ===========================================================================

  describe('updateOrganizationLogo', () => {
    it('should upload organization logo', async () => {
      const updatedOrg = mockOrganization({
        image_url: 'https://img.clerk.com/org_test123_logo.png',
        has_image: true,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const file = new File(['logo-data'], 'logo.png', { type: 'image/png' })
      const org = await clerk.organizations.updateOrganizationLogo('org_test123', {
        file,
      })

      expect(org.image_url).toBe('https://img.clerk.com/org_test123_logo.png')
      expect(org.has_image).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/logo'),
        expect.objectContaining({
          method: 'PUT',
        })
      )
    })

    it('should upload logo with uploader_user_id', async () => {
      const updatedOrg = mockOrganization({
        image_url: 'https://img.clerk.com/org_test123_logo.png',
        has_image: true,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const file = new File(['logo-data'], 'logo.png', { type: 'image/png' })
      const org = await clerk.organizations.updateOrganizationLogo('org_test123', {
        file,
        uploaderUserId: 'user_admin123',
      })

      expect(org.has_image).toBe(true)
    })

    it('should handle invalid file type', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'invalid_file_type',
                message: 'File type not supported',
                long_message: 'Only PNG, JPG, GIF, and WebP images are supported.',
              },
            ],
          },
          422
        )
      )

      const file = new File(['pdf-data'], 'document.pdf', { type: 'application/pdf' })
      await expect(
        clerk.organizations.updateOrganizationLogo('org_test123', { file })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle file too large', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [
              {
                code: 'file_too_large',
                message: 'File exceeds maximum size',
                meta: { max_size_bytes: 10485760 },
              },
            ],
          },
          413
        )
      )

      const file = new File(['large-image-data'], 'large.png', { type: 'image/png' })
      await expect(
        clerk.organizations.updateOrganizationLogo('org_test123', { file })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should handle organization not found', async () => {
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

      const file = new File(['logo-data'], 'logo.png', { type: 'image/png' })
      await expect(
        clerk.organizations.updateOrganizationLogo('org_nonexistent', { file })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('deleteOrganizationLogo', () => {
    it('should delete organization logo', async () => {
      const updatedOrg = mockOrganization({
        image_url: null,
        has_image: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(updatedOrg))

      const org = await clerk.organizations.deleteOrganizationLogo('org_test123')

      expect(org.image_url).toBeNull()
      expect(org.has_image).toBe(false)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/organizations/org_test123/logo'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })

    it('should handle organization without logo', async () => {
      // Deleting a logo that doesn't exist should still succeed
      const org = mockOrganization({
        image_url: null,
        has_image: false,
      })
      mockFetch.mockResolvedValueOnce(createMockResponse(org))

      const result = await clerk.organizations.deleteOrganizationLogo('org_test123')

      expect(result.has_image).toBe(false)
    })

    it('should handle organization not found', async () => {
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
        clerk.organizations.deleteOrganizationLogo('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })
})

// =============================================================================
// Organization Types Tests - These will FAIL (RED phase)
// =============================================================================

describe('@dotdo/clerk - Organization Types', () => {
  it('should export Organization type', () => {
    // This test verifies the Organization type is exported
    // Will fail if type doesn't exist in index.ts
    const org: Organization = {
      id: 'org_test123',
      object: 'organization',
      name: 'Test',
      slug: 'test',
      image_url: null,
      has_image: false,
      members_count: 0,
      pending_invitations_count: 0,
      max_allowed_memberships: 5,
      admin_delete_enabled: true,
      public_metadata: {},
      private_metadata: {},
      created_by: 'user_xxx',
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    expect(org.object).toBe('organization')
  })

  it('should export OrganizationList type', () => {
    const list: OrganizationList = {
      data: [],
      total_count: 0,
    }
    expect(list.total_count).toBe(0)
  })

  it('should export CreateOrganizationParams type', () => {
    const params: CreateOrganizationParams = {
      name: 'Test',
    }
    expect(params.name).toBe('Test')
  })

  it('should export UpdateOrganizationParams type', () => {
    const params: UpdateOrganizationParams = {
      name: 'Updated',
    }
    expect(params.name).toBe('Updated')
  })

  it('should export ListOrganizationsParams type', () => {
    const params: ListOrganizationsParams = {
      limit: 10,
    }
    expect(params.limit).toBe(10)
  })
})

// =============================================================================
// Organization Error Handling Tests
// =============================================================================

describe('@dotdo/clerk - Organization Error Handling', () => {
  let clerk: Clerk

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = mockFetch
    clerk = new Clerk({ secretKey: 'sk_test_xxx' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle rate limiting for organization operations', async () => {
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
      clerk.organizations.listOrganizations()
    ).rejects.toThrow(ClerkAPIError)

    try {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          {
            errors: [{ code: 'rate_limit_exceeded', message: 'Too many requests' }],
          },
          429
        )
      )
      await clerk.organizations.listOrganizations()
    } catch (error) {
      expect((error as ClerkAPIError).status).toBe(429)
      expect((error as ClerkAPIError).code).toBe('rate_limit_exceeded')
    }
  })

  it('should handle authentication errors for organization operations', async () => {
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
      clerk.organizations.getOrganization('org_test123')
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle server errors for organization operations', async () => {
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
      clerk.organizations.createOrganization({ name: 'Test' })
    ).rejects.toThrow(ClerkAPIError)
  })

  it('should handle network errors for organization operations', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    await expect(
      clerk.organizations.getOrganization('org_test123')
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
      clerk.organizations.deleteOrganization('org_test123')
    ).rejects.toThrow(ClerkAPIError)
  })
})
