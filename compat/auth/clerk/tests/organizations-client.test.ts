/**
 * Clerk Organizations API - Client Integration Tests (RED Phase)
 *
 * Comprehensive failing tests to drive implementation of Clerk-compatible
 * organization management via the createClerkClient interface.
 *
 * These tests follow the Clerk Backend API specification for organizations:
 * - Organization CRUD operations via client
 * - Organization metadata management
 * - Logo management
 * - Slug-based lookups
 * - Membership metadata
 * - Bulk invitations
 * - Roles and Permissions via client
 * - Domain management via client
 *
 * NOTE: These tests are in the RED phase - they should FAIL because the
 * implementation doesn't exist yet. Do NOT implement the functionality.
 *
 * @see https://clerk.com/docs/reference/backend-api#tag/Organizations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Clerk,
  createClerkClient,
  ClerkAPIError,
  type ClerkOrganization,
  type ClerkOrganizationMembership,
  type ClerkOrganizationInvitation,
  type ClerkOrganizationRole,
  type ClerkOrganizationPermission,
  type ClerkOrganizationDomain,
} from '../index'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Clerk Organizations Client API', () => {
  let clerk: Clerk
  let testUserId: string
  let secondUserId: string

  beforeEach(async () => {
    clerk = createClerkClient({
      secretKey: 'sk_test_organizations_test_key_at_least_32_chars_long',
      publishableKey: 'pk_test_organizations_key',
    })

    // Create test users
    const user = await clerk.users.createUser({
      email_address: [`org-test-${Date.now()}@example.com`],
      password: 'Test123!@#Password',
      first_name: 'Organization',
      last_name: 'Tester',
    })
    testUserId = user.id

    const user2 = await clerk.users.createUser({
      email_address: [`org-test-member-${Date.now()}@example.com`],
      password: 'Test123!@#Password',
      first_name: 'Member',
      last_name: 'User',
    })
    secondUserId = user2.id
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // 1. ORGANIZATION SLUG OPERATIONS (5 tests)
  // ============================================================================

  describe('Organization Slug Operations', () => {
    it('should get organization by slug', async () => {
      const created = await clerk.organizations.createOrganization({
        name: 'Slug Test Org',
        slug: 'slug-test-org',
        created_by: testUserId,
      })

      // This method doesn't exist on clerk.organizations yet
      const org = await clerk.organizations.getOrganizationBySlug('slug-test-org')

      expect(org).toBeDefined()
      expect(org.id).toBe(created.id)
      expect(org.slug).toBe('slug-test-org')
    })

    it('should throw 404 for non-existent slug', async () => {
      await expect(
        clerk.organizations.getOrganizationBySlug('nonexistent-slug-xyz')
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.getOrganizationBySlug('nonexistent-slug-xyz')
      } catch (error) {
        expect(error).toBeInstanceOf(ClerkAPIError)
        expect((error as ClerkAPIError).status).toBe(404)
        expect((error as ClerkAPIError).errors[0].code).toBe('resource_not_found')
      }
    })

    it('should reject duplicate slugs during creation', async () => {
      await clerk.organizations.createOrganization({
        name: 'First Org',
        slug: 'duplicate-slug',
        created_by: testUserId,
      })

      await expect(
        clerk.organizations.createOrganization({
          name: 'Second Org',
          slug: 'duplicate-slug',
          created_by: testUserId,
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganization({
          name: 'Another Org',
          slug: 'duplicate-slug',
          created_by: testUserId,
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('form_identifier_exists')
      }
    })

    it('should allow slug update during organization update', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Rename Slug Org',
        slug: 'original-slug',
        created_by: testUserId,
      })

      const updated = await clerk.organizations.updateOrganization(org.id, {
        slug: 'new-slug',
      })

      expect(updated.slug).toBe('new-slug')

      // Old slug should no longer work
      await expect(
        clerk.organizations.getOrganizationBySlug('original-slug')
      ).rejects.toThrow(ClerkAPIError)

      // New slug should work
      const fetched = await clerk.organizations.getOrganizationBySlug('new-slug')
      expect(fetched.id).toBe(org.id)
    })

    it('should auto-generate slug from name if not provided', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'My Awesome Company LLC',
        created_by: testUserId,
      })

      expect(org.slug).toBe('my-awesome-company-llc')
    })
  })

  // ============================================================================
  // 2. ORGANIZATION METADATA OPERATIONS (6 tests)
  // ============================================================================

  describe('Organization Metadata Operations', () => {
    it('should update organization metadata separately', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Metadata Org',
        created_by: testUserId,
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationMetadata(org.id, {
        public_metadata: { tier: 'enterprise', features: ['sso', 'audit-log'] },
        private_metadata: { internal_id: 'int_123', billing_id: 'bill_456' },
      })

      expect(updated.public_metadata).toEqual({ tier: 'enterprise', features: ['sso', 'audit-log'] })
      expect(updated.private_metadata).toEqual({ internal_id: 'int_123', billing_id: 'bill_456' })
    })

    it('should merge metadata with existing values', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Merge Metadata Org',
        created_by: testUserId,
        public_metadata: { existing: 'value' },
      })

      const updated = await clerk.organizations.updateOrganizationMetadata(org.id, {
        public_metadata: { new_key: 'new_value' },
      })

      expect(updated.public_metadata.existing).toBe('value')
      expect(updated.public_metadata.new_key).toBe('new_value')
    })

    it('should allow null values to remove metadata keys', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Remove Metadata Org',
        created_by: testUserId,
        public_metadata: { key_to_remove: 'value', key_to_keep: 'value' },
      })

      const updated = await clerk.organizations.updateOrganizationMetadata(org.id, {
        public_metadata: { key_to_remove: null, key_to_keep: 'updated' },
      })

      expect(updated.public_metadata.key_to_remove).toBeUndefined()
      expect(updated.public_metadata.key_to_keep).toBe('updated')
    })

    it('should support nested metadata structures', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Nested Metadata Org',
        created_by: testUserId,
      })

      const updated = await clerk.organizations.updateOrganizationMetadata(org.id, {
        public_metadata: {
          settings: {
            theme: {
              primary_color: '#ff0000',
              secondary_color: '#00ff00',
            },
            features: {
              dark_mode: true,
              notifications: { email: true, sms: false },
            },
          },
        },
      })

      expect(updated.public_metadata.settings.theme.primary_color).toBe('#ff0000')
      expect(updated.public_metadata.settings.features.notifications.email).toBe(true)
    })

    it('should enforce metadata size limits', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Large Metadata Org',
        created_by: testUserId,
      })

      const largeData = 'x'.repeat(100000) // 100KB string

      await expect(
        clerk.organizations.updateOrganizationMetadata(org.id, {
          public_metadata: { large_key: largeData },
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.updateOrganizationMetadata(org.id, {
          public_metadata: { large_key: largeData },
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('metadata_size_exceeded')
      }
    })

    it('should throw 404 for non-existent organization', async () => {
      await expect(
        clerk.organizations.updateOrganizationMetadata('org_nonexistent', {
          public_metadata: { test: 'value' },
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ============================================================================
  // 3. ORGANIZATION LOGO OPERATIONS (5 tests)
  // ============================================================================

  describe('Organization Logo Operations', () => {
    it('should update organization logo', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Logo Org',
        created_by: testUserId,
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationLogo(org.id, {
        url: 'https://example.com/logo.png',
      })

      expect(updated.image_url).toBe('https://example.com/logo.png')
      expect(updated.has_image).toBe(true)
    })

    it('should delete organization logo', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Delete Logo Org',
        created_by: testUserId,
      })

      await clerk.organizations.updateOrganizationLogo(org.id, {
        url: 'https://example.com/logo.png',
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.deleteOrganizationLogo(org.id)

      expect(updated.image_url).toBe('')
      expect(updated.has_image).toBe(false)
    })

    it('should validate logo URL format', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Invalid Logo Org',
        created_by: testUserId,
      })

      await expect(
        clerk.organizations.updateOrganizationLogo(org.id, {
          url: 'not-a-valid-url',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should throw 404 for non-existent organization on logo update', async () => {
      await expect(
        clerk.organizations.updateOrganizationLogo('org_nonexistent', {
          url: 'https://example.com/logo.png',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should throw 404 for non-existent organization on logo delete', async () => {
      await expect(
        clerk.organizations.deleteOrganizationLogo('org_nonexistent')
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ============================================================================
  // 4. MEMBERSHIP METADATA OPERATIONS (5 tests)
  // ============================================================================

  describe('Membership Metadata Operations', () => {
    it('should update membership metadata', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Membership Metadata Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationMembershipMetadata({
        organizationId: org.id,
        userId: secondUserId,
        public_metadata: { department: 'engineering', team: 'platform' },
        private_metadata: { employee_id: 'emp_123' },
      })

      expect(updated.public_metadata).toEqual({ department: 'engineering', team: 'platform' })
      expect(updated.private_metadata).toEqual({ employee_id: 'emp_123' })
    })

    it('should merge membership metadata with existing values', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Merge Membership Metadata Org',
        created_by: testUserId,
      })

      // This method should accept metadata during creation
      const membership = await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
        public_metadata: { existing: 'value' },
      })

      const updated = await clerk.organizations.updateOrganizationMembershipMetadata({
        organizationId: org.id,
        userId: secondUserId,
        public_metadata: { new_key: 'new_value' },
      })

      expect(updated.public_metadata.existing).toBe('value')
      expect(updated.public_metadata.new_key).toBe('new_value')
    })

    it('should throw 404 for non-existent organization', async () => {
      await expect(
        clerk.organizations.updateOrganizationMembershipMetadata({
          organizationId: 'org_nonexistent',
          userId: testUserId,
          public_metadata: { test: 'value' },
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should throw 404 for non-existent membership', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Missing Membership Org',
        created_by: testUserId,
      })

      await expect(
        clerk.organizations.updateOrganizationMembershipMetadata({
          organizationId: org.id,
          userId: 'user_nonexistent',
          public_metadata: { test: 'value' },
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should support creating membership with metadata', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Create With Metadata Org',
        created_by: testUserId,
      })

      // This signature should accept metadata
      const membership = await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
        public_metadata: { department: 'sales' },
        private_metadata: { employee_id: 'emp_456' },
      })

      expect(membership.public_metadata).toEqual({ department: 'sales' })
      expect(membership.private_metadata).toEqual({ employee_id: 'emp_456' })
    })
  })

  // ============================================================================
  // 5. INVITATION OPERATIONS (10 tests)
  // ============================================================================

  describe('Invitation Operations', () => {
    it('should get single invitation by ID', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Get Invitation Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'get-invitation@example.com',
        role: 'member',
      })

      // This method doesn't exist yet
      const invitation = await clerk.organizations.getOrganizationInvitation({
        organizationId: org.id,
        invitationId: created.id,
      })

      expect(invitation.id).toBe(created.id)
      expect(invitation.email_address).toBe('get-invitation@example.com')
    })

    it('should create bulk invitations', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Bulk Invitation Org',
        created_by: testUserId,
      })

      // This method doesn't exist yet
      const result = await clerk.organizations.createBulkOrganizationInvitations(org.id, [
        { email_address: 'bulk1@example.com', role: 'member' },
        { email_address: 'bulk2@example.com', role: 'member' },
        { email_address: 'bulk3@example.com', role: 'admin' },
      ])

      expect(result.total_count).toBe(3)
      expect(result.data).toHaveLength(3)
      expect(result.data.map((i) => i.email_address)).toContain('bulk1@example.com')
      expect(result.data.map((i) => i.email_address)).toContain('bulk2@example.com')
      expect(result.data.map((i) => i.email_address)).toContain('bulk3@example.com')
    })

    it('should handle partial failures in bulk invitations', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Partial Bulk Org',
        created_by: testUserId,
      })

      // Create one invitation first
      await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'existing@example.com',
        role: 'member',
      })

      // Bulk create including duplicate
      const result = await clerk.organizations.createBulkOrganizationInvitations(org.id, [
        { email_address: 'new1@example.com', role: 'member' },
        { email_address: 'existing@example.com', role: 'member' }, // Duplicate
        { email_address: 'new2@example.com', role: 'member' },
      ])

      expect(result.total_count).toBe(2) // Only 2 succeeded
    })

    it('should get pending invitations by email', async () => {
      const org1 = await clerk.organizations.createOrganization({
        name: 'Pending Org 1',
        created_by: testUserId,
      })

      const org2 = await clerk.organizations.createOrganization({
        name: 'Pending Org 2',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationInvitation(org1.id, {
        email_address: 'pending-user@example.com',
        role: 'member',
      })

      await clerk.organizations.createOrganizationInvitation(org2.id, {
        email_address: 'pending-user@example.com',
        role: 'admin',
      })

      // This method doesn't exist yet
      const result = await clerk.organizations.getPendingOrganizationInvitationList({
        user_email_address: 'pending-user@example.com',
      })

      expect(result.total_count).toBe(2)
      expect(result.data.every((i) => i.status === 'pending')).toBe(true)
    })

    it('should filter invitation list by status', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Filter Invitation Org',
        created_by: testUserId,
      })

      const inv1 = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'filter1@example.com',
        role: 'member',
      })

      await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'filter2@example.com',
        role: 'member',
      })

      await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.id,
        invitationId: inv1.id,
      })

      const pendingInvitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: org.id,
        status: 'pending',
      })

      expect(pendingInvitations.total_count).toBe(1)
      expect(pendingInvitations.data[0].email_address).toBe('filter2@example.com')
    })

    it('should reject duplicate pending invitations', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Duplicate Invitation Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'duplicate@example.com',
        role: 'member',
      })

      await expect(
        clerk.organizations.createOrganizationInvitation(org.id, {
          email_address: 'duplicate@example.com',
          role: 'admin',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganizationInvitation(org.id, {
          email_address: 'duplicate@example.com',
          role: 'admin',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('duplicate_record')
      }
    })

    it('should allow re-inviting after revocation', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Re-invite Org',
        created_by: testUserId,
      })

      const inv1 = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'reinvite@example.com',
        role: 'member',
      })

      await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.id,
        invitationId: inv1.id,
      })

      // Should not throw
      const inv2 = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'reinvite@example.com',
        role: 'admin',
      })

      expect(inv2.id).not.toBe(inv1.id)
      expect(inv2.status).toBe('pending')
    })

    it('should support invitation metadata', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Invitation Metadata Org',
        created_by: testUserId,
      })

      const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'invitation-metadata@example.com',
        role: 'member',
        public_metadata: { department: 'engineering' },
        private_metadata: { referral_code: 'ref_123' },
      })

      expect(invitation.public_metadata).toEqual({ department: 'engineering' })
      expect(invitation.private_metadata).toEqual({ referral_code: 'ref_123' })
    })

    it('should set invitation expiration', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Expiring Invitation Org',
        created_by: testUserId,
      })

      const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'expiring@example.com',
        role: 'member',
        expires_in_days: 7,
      })

      expect(invitation.expires_at).toBeDefined()
      // Should expire in approximately 7 days
      const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000
      expect(invitation.expires_at).toBeGreaterThan(expectedExpiry - 60000) // Allow 1 minute variance
      expect(invitation.expires_at).toBeLessThan(expectedExpiry + 60000)
    })

    it('should throw when revoking non-pending invitation', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Already Revoked Org',
        created_by: testUserId,
      })

      const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'already-revoked@example.com',
        role: 'member',
      })

      await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.id,
        invitationId: invitation.id,
      })

      await expect(
        clerk.organizations.revokeOrganizationInvitation({
          organizationId: org.id,
          invitationId: invitation.id,
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.revokeOrganizationInvitation({
          organizationId: org.id,
          invitationId: invitation.id,
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('invalid_state')
      }
    })
  })

  // ============================================================================
  // 6. ROLES MANAGEMENT VIA CLIENT (10 tests)
  // ============================================================================

  describe('Roles Management via Client', () => {
    it('should list organization roles', async () => {
      // This method doesn't exist yet
      const result = await clerk.organizations.getOrganizationRoleList()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.total_count).toBeGreaterThanOrEqual(2) // At least admin and member

      const adminRole = result.data.find((r) => r.key === 'org:admin')
      const memberRole = result.data.find((r) => r.key === 'org:member')

      expect(adminRole).toBeDefined()
      expect(memberRole).toBeDefined()
    })

    it('should get role by ID', async () => {
      // This method doesn't exist yet
      const role = await clerk.organizations.getOrganizationRole('role_admin')

      expect(role).toBeDefined()
      expect(role.key).toBe('org:admin')
      expect(role.object).toBe('role')
    })

    it('should create custom role', async () => {
      // This method doesn't exist yet
      const role = await clerk.organizations.createOrganizationRole({
        name: 'Manager',
        key: 'org:manager',
        description: 'Team manager with limited admin access',
        permissions: ['org:sys_profile:read', 'org:sys_memberships:read', 'org:sys_memberships:manage'],
      })

      expect(role).toBeDefined()
      expect(role.id).toMatch(/^role_/)
      expect(role.object).toBe('role')
      expect(role.name).toBe('Manager')
      expect(role.key).toBe('org:manager')
      expect(role.permissions).toContain('org:sys_memberships:manage')
    })

    it('should update custom role', async () => {
      const created = await clerk.organizations.createOrganizationRole({
        name: 'Editor',
        key: 'org:editor',
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationRole(created.id, {
        name: 'Senior Editor',
        permissions: ['org:sys_profile:read'],
      })

      expect(updated.name).toBe('Senior Editor')
      expect(updated.permissions).toContain('org:sys_profile:read')
    })

    it('should delete custom role', async () => {
      const created = await clerk.organizations.createOrganizationRole({
        name: 'Temporary Role',
        key: 'org:temp-role',
      })

      // This method doesn't exist yet
      const result = await clerk.organizations.deleteOrganizationRole(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)
    })

    it('should not allow deleting system roles', async () => {
      await expect(
        clerk.organizations.deleteOrganizationRole('role_admin')
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.deleteOrganizationRole('role_admin')
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('forbidden')
      }
    })

    it('should not allow modifying system roles', async () => {
      await expect(
        clerk.organizations.updateOrganizationRole('role_admin', {
          name: 'Modified Admin',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.updateOrganizationRole('role_admin', {
          name: 'Modified Admin',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('forbidden')
      }
    })

    it('should assign permission to role', async () => {
      const role = await clerk.organizations.createOrganizationRole({
        name: 'Viewer',
        key: 'org:viewer',
        permissions: [],
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.assignPermissionToRole(
        role.id,
        'perm_sys_profile_read'
      )

      expect(updated.permissions).toContain('org:sys_profile:read')
    })

    it('should remove permission from role', async () => {
      const role = await clerk.organizations.createOrganizationRole({
        name: 'Limited',
        key: 'org:limited',
        permissions: ['org:sys_profile:read', 'org:sys_memberships:read'],
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.removePermissionFromRole(
        role.id,
        'perm_sys_memberships_read'
      )

      expect(updated.permissions).not.toContain('org:sys_memberships:read')
      expect(updated.permissions).toContain('org:sys_profile:read')
    })

    it('should reject duplicate role keys', async () => {
      await clerk.organizations.createOrganizationRole({
        name: 'First Role',
        key: 'org:duplicate-key',
      })

      await expect(
        clerk.organizations.createOrganizationRole({
          name: 'Second Role',
          key: 'org:duplicate-key',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganizationRole({
          name: 'Third Role',
          key: 'org:duplicate-key',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('duplicate_record')
      }
    })
  })

  // ============================================================================
  // 7. PERMISSIONS MANAGEMENT VIA CLIENT (8 tests)
  // ============================================================================

  describe('Permissions Management via Client', () => {
    it('should list organization permissions', async () => {
      // This method doesn't exist yet
      const result = await clerk.organizations.getOrganizationPermissionList()

      expect(result.data).toBeDefined()
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.total_count).toBeGreaterThanOrEqual(7) // System permissions
    })

    it('should get permission by ID', async () => {
      // This method doesn't exist yet
      const permission = await clerk.organizations.getOrganizationPermission('perm_sys_profile_read')

      expect(permission).toBeDefined()
      expect(permission.key).toBe('org:sys_profile:read')
      expect(permission.type).toBe('system')
    })

    it('should create custom permission', async () => {
      // This method doesn't exist yet
      const permission = await clerk.organizations.createOrganizationPermission({
        name: 'Manage Projects',
        key: 'org:projects:manage',
        description: 'Create, update, and delete projects',
      })

      expect(permission).toBeDefined()
      expect(permission.id).toMatch(/^perm_/)
      expect(permission.object).toBe('permission')
      expect(permission.type).toBe('custom')
    })

    it('should update custom permission', async () => {
      const created = await clerk.organizations.createOrganizationPermission({
        name: 'View Reports',
        key: 'org:reports:view',
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationPermission(created.id, {
        name: 'View All Reports',
        description: 'Access to all reporting features',
      })

      expect(updated.name).toBe('View All Reports')
      expect(updated.description).toBe('Access to all reporting features')
    })

    it('should delete custom permission', async () => {
      const created = await clerk.organizations.createOrganizationPermission({
        name: 'Temporary Permission',
        key: 'org:temp:perm',
      })

      // This method doesn't exist yet
      const result = await clerk.organizations.deleteOrganizationPermission(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)
    })

    it('should not allow deleting system permissions', async () => {
      await expect(
        clerk.organizations.deleteOrganizationPermission('perm_sys_profile_read')
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.deleteOrganizationPermission('perm_sys_profile_read')
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('forbidden')
      }
    })

    it('should not allow modifying system permissions', async () => {
      await expect(
        clerk.organizations.updateOrganizationPermission('perm_sys_profile_read', {
          name: 'Modified Permission',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.updateOrganizationPermission('perm_sys_profile_read', {
          name: 'Modified Permission',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('forbidden')
      }
    })

    it('should reject duplicate permission keys', async () => {
      await clerk.organizations.createOrganizationPermission({
        name: 'First Permission',
        key: 'org:duplicate-perm-key',
      })

      await expect(
        clerk.organizations.createOrganizationPermission({
          name: 'Second Permission',
          key: 'org:duplicate-perm-key',
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  // ============================================================================
  // 8. DOMAIN MANAGEMENT VIA CLIENT (12 tests)
  // ============================================================================

  describe('Domain Management via Client', () => {
    it('should create organization domain', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Domain Org',
        created_by: testUserId,
      })

      // This method doesn't exist yet
      const domain = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'example.com',
      })

      expect(domain).toBeDefined()
      expect(domain.id).toMatch(/^dom_/)
      expect(domain.object).toBe('organization_domain')
      expect(domain.name).toBe('example.com')
      expect(domain.enrollment_mode).toBe('manual_invitation')
    })

    it('should create verified domain', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Verified Domain Org',
        created_by: testUserId,
      })

      const domain = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'verified.example.com',
        verified: true,
      })

      expect(domain.verification).toBeDefined()
      expect(domain.verification?.status).toBe('verified')
    })

    it('should create domain with enrollment mode', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Auto Invite Domain Org',
        created_by: testUserId,
      })

      const domain = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'auto-invite.example.com',
        enrollment_mode: 'automatic_invitation',
      })

      expect(domain.enrollment_mode).toBe('automatic_invitation')
    })

    it('should list organization domains', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'List Domains Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationDomain(org.id, { name: 'domain1.example.com' })
      await clerk.organizations.createOrganizationDomain(org.id, { name: 'domain2.example.com' })

      // This method doesn't exist yet
      const result = await clerk.organizations.getOrganizationDomainList({
        organizationId: org.id,
      })

      expect(result.total_count).toBe(2)
      expect(result.data).toHaveLength(2)
    })

    it('should get domain by ID', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Get Domain Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'get.example.com',
      })

      // This method doesn't exist yet
      const domain = await clerk.organizations.getOrganizationDomain({
        organizationId: org.id,
        domainId: created.id,
      })

      expect(domain.id).toBe(created.id)
      expect(domain.name).toBe('get.example.com')
    })

    it('should update domain enrollment mode', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Update Domain Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'update.example.com',
      })

      // This method doesn't exist yet
      const updated = await clerk.organizations.updateOrganizationDomain({
        organizationId: org.id,
        domainId: created.id,
        enrollment_mode: 'automatic_suggestion',
      })

      expect(updated.enrollment_mode).toBe('automatic_suggestion')
    })

    it('should delete organization domain', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Delete Domain Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'delete.example.com',
      })

      // This method doesn't exist yet
      const result = await clerk.organizations.deleteOrganizationDomain({
        organizationId: org.id,
        domainId: created.id,
      })

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)
    })

    it('should prepare domain verification with email strategy', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Prepare Verify Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'prepare-verify.example.com',
      })

      // This method doesn't exist yet
      const prepared = await clerk.organizations.prepareOrganizationDomainVerification({
        organizationId: org.id,
        domainId: created.id,
        strategy: 'email_code',
        affiliation_email_address: 'admin@prepare-verify.example.com',
      })

      expect(prepared.verification).toBeDefined()
      expect(prepared.verification?.status).toBe('unverified')
      expect(prepared.verification?.strategy).toBe('email_code')
      expect(prepared.affiliation_email_address).toBe('admin@prepare-verify.example.com')
    })

    it('should verify organization domain', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Verify Domain Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'verify.example.com',
      })

      await clerk.organizations.prepareOrganizationDomainVerification({
        organizationId: org.id,
        domainId: created.id,
        strategy: 'email_code',
      })

      // This method doesn't exist yet
      const verified = await clerk.organizations.verifyOrganizationDomain({
        organizationId: org.id,
        domainId: created.id,
      })

      expect(verified.verification?.status).toBe('verified')
    })

    it('should reject duplicate domains across organizations', async () => {
      const org1 = await clerk.organizations.createOrganization({
        name: 'Duplicate Domain Org 1',
        created_by: testUserId,
      })

      const org2 = await clerk.organizations.createOrganization({
        name: 'Duplicate Domain Org 2',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationDomain(org1.id, {
        name: 'unique-domain.example.com',
      })

      await expect(
        clerk.organizations.createOrganizationDomain(org2.id, {
          name: 'unique-domain.example.com',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganizationDomain(org2.id, {
          name: 'unique-domain.example.com',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('duplicate_record')
      }
    })

    it('should filter domains by verification status', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Filter Domains Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'unverified.example.com',
      })

      await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'verified.example.com',
        verified: true,
      })

      const verifiedDomains = await clerk.organizations.getOrganizationDomainList({
        organizationId: org.id,
        verified: true,
      })

      expect(verifiedDomains.total_count).toBe(1)
      expect(verifiedDomains.data[0].name).toBe('verified.example.com')

      const unverifiedDomains = await clerk.organizations.getOrganizationDomainList({
        organizationId: org.id,
        verified: false,
      })

      expect(unverifiedDomains.total_count).toBe(1)
      expect(unverifiedDomains.data[0].name).toBe('unverified.example.com')
    })

    it('should throw when verifying without preparation', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'No Prep Verify Org',
        created_by: testUserId,
      })

      const created = await clerk.organizations.createOrganizationDomain(org.id, {
        name: 'no-prep.example.com',
      })

      await expect(
        clerk.organizations.verifyOrganizationDomain({
          organizationId: org.id,
          domainId: created.id,
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.verifyOrganizationDomain({
          organizationId: org.id,
          domainId: created.id,
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('invalid_state')
      }
    })
  })

  // ============================================================================
  // 9. ORGANIZATION LIST OPERATIONS (5 tests)
  // ============================================================================

  describe('Organization List Operations', () => {
    it('should list organizations for user', async () => {
      await clerk.organizations.createOrganization({
        name: 'User Org 1',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganization({
        name: 'User Org 2',
        created_by: testUserId,
      })

      const result = await clerk.organizations.getOrganizationList({
        user_id: [testUserId],
      })

      expect(result.total_count).toBeGreaterThanOrEqual(2)
    })

    it('should support query parameter for search', async () => {
      await clerk.organizations.createOrganization({
        name: 'Acme Corporation',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganization({
        name: 'Beta Industries',
        created_by: testUserId,
      })

      const result = await clerk.organizations.getOrganizationList({
        query: 'Acme',
      })

      expect(result.total_count).toBe(1)
      expect(result.data[0].name).toBe('Acme Corporation')
    })

    it('should support pagination', async () => {
      // Create multiple organizations
      for (let i = 0; i < 5; i++) {
        await clerk.organizations.createOrganization({
          name: `Paginated Org ${i}`,
          created_by: testUserId,
        })
      }

      const page1 = await clerk.organizations.getOrganizationList({
        user_id: [testUserId],
        limit: 2,
        offset: 0,
      })

      const page2 = await clerk.organizations.getOrganizationList({
        user_id: [testUserId],
        limit: 2,
        offset: 2,
      })

      expect(page1.data).toHaveLength(2)
      expect(page2.data).toHaveLength(2)
      expect(page1.data[0].id).not.toBe(page2.data[0].id)
    })

    it('should support order_by parameter', async () => {
      await clerk.organizations.createOrganization({
        name: 'Zebra Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganization({
        name: 'Alpha Org',
        created_by: testUserId,
      })

      const resultAsc = await clerk.organizations.getOrganizationList({
        user_id: [testUserId],
        order_by: 'name',
      })

      expect(resultAsc.data[0].name).toBe('Alpha Org')
    })

    it('should include members_count when requested', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Members Count Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      const result = await clerk.organizations.getOrganizationList({
        user_id: [testUserId],
        include_members_count: true,
      })

      const foundOrg = result.data.find((o) => o.id === org.id)
      expect(foundOrg).toBeDefined()
      expect(foundOrg?.members_count).toBe(2)
    })
  })

  // ============================================================================
  // 10. MEMBERSHIP CONSTRAINTS (5 tests)
  // ============================================================================

  describe('Membership Constraints', () => {
    it('should enforce max_allowed_memberships limit', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Limited Org',
        created_by: testUserId,
        max_allowed_memberships: 2,
      })

      // First membership is creator (admin)
      // Second membership
      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      // Create third user for the test
      const thirdUser = await clerk.users.createUser({
        email_address: [`third-user-${Date.now()}@example.com`],
        password: 'Test123!@#',
      })

      // Third membership should fail
      await expect(
        clerk.organizations.createOrganizationMembership({
          organizationId: org.id,
          userId: thirdUser.id,
          role: 'member',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganizationMembership({
          organizationId: org.id,
          userId: thirdUser.id,
          role: 'member',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('organization_membership_quota_exceeded')
      }
    })

    it('should reject duplicate membership', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Duplicate Membership Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      await expect(
        clerk.organizations.createOrganizationMembership({
          organizationId: org.id,
          userId: secondUserId,
          role: 'admin',
        })
      ).rejects.toThrow(ClerkAPIError)

      try {
        await clerk.organizations.createOrganizationMembership({
          organizationId: org.id,
          userId: secondUserId,
          role: 'admin',
        })
      } catch (error) {
        expect((error as ClerkAPIError).errors[0].code).toBe('duplicate_record')
      }
    })

    it('should update member count on membership deletion', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Member Count Update Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      let currentOrg = await clerk.organizations.getOrganization(org.id)
      expect(currentOrg.members_count).toBe(2)

      await clerk.organizations.deleteOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
      })

      currentOrg = await clerk.organizations.getOrganization(org.id)
      expect(currentOrg.members_count).toBe(1)
    })

    it('should filter memberships by role', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Role Filter Org',
        created_by: testUserId,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: secondUserId,
        role: 'member',
      })

      const admins = await clerk.organizations.getOrganizationMembershipList({
        organizationId: org.id,
        role: ['admin'],
      })

      expect(admins.total_count).toBe(1)

      const members = await clerk.organizations.getOrganizationMembershipList({
        organizationId: org.id,
        role: ['member'],
      })

      expect(members.total_count).toBe(1)
    })

    it('should support membership pagination', async () => {
      const org = await clerk.organizations.createOrganization({
        name: 'Paginated Membership Org',
        created_by: testUserId,
        max_allowed_memberships: 10,
      })

      // Create multiple members
      for (let i = 0; i < 5; i++) {
        const user = await clerk.users.createUser({
          email_address: [`paginated-member-${i}-${Date.now()}@example.com`],
          password: 'Test123!@#',
        })

        await clerk.organizations.createOrganizationMembership({
          organizationId: org.id,
          userId: user.id,
          role: 'member',
        })
      }

      const page1 = await clerk.organizations.getOrganizationMembershipList({
        organizationId: org.id,
        limit: 3,
        offset: 0,
      })

      const page2 = await clerk.organizations.getOrganizationMembershipList({
        organizationId: org.id,
        limit: 3,
        offset: 3,
      })

      expect(page1.data).toHaveLength(3)
      expect(page2.data).toHaveLength(3)
    })
  })
})
