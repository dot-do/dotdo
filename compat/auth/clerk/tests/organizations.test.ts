/**
 * Clerk Organizations API Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createOrganizationsManager, type OrganizationsAPI } from '../organizations'
import { createUserManager, type UserManager } from '../../shared/users'
import { ClerkAPIError } from '../types'

describe('Organizations API', () => {
  let orgs: OrganizationsAPI
  let userManager: UserManager
  let testUserId: string

  beforeEach(async () => {
    userManager = createUserManager()
    orgs = createOrganizationsManager({ userManager })

    // Create a test user
    const user = await userManager.createUser({
      email: 'test@example.com',
      password: 'Test123!@#',
      first_name: 'Test',
      last_name: 'User',
    })
    testUserId = user.id
  })

  describe('Organization CRUD', () => {
    it('should create an organization', async () => {
      const org = await orgs.createOrganization({
        name: 'Acme Inc',
        created_by: testUserId,
      })

      expect(org).toBeDefined()
      expect(org.id).toBeDefined()
      expect(org.object).toBe('organization')
      expect(org.name).toBe('Acme Inc')
      expect(org.slug).toBe('acme-inc')
      expect(org.members_count).toBe(1)
    })

    it('should create organization with custom slug', async () => {
      const org = await orgs.createOrganization({
        name: 'Acme Inc',
        slug: 'acme',
        created_by: testUserId,
      })

      expect(org.slug).toBe('acme')
    })

    it('should create organization with metadata', async () => {
      const org = await orgs.createOrganization({
        name: 'Meta Org',
        created_by: testUserId,
        public_metadata: { tier: 'enterprise' },
        private_metadata: { internal: true },
      })

      expect(org.public_metadata).toEqual({ tier: 'enterprise' })
      expect(org.private_metadata).toEqual({ internal: true })
    })

    it('should get organization by ID', async () => {
      const created = await orgs.createOrganization({
        name: 'Get Org',
        created_by: testUserId,
      })

      const org = await orgs.getOrganization(created.id)

      expect(org.id).toBe(created.id)
      expect(org.name).toBe('Get Org')
    })

    it('should get organization by slug', async () => {
      const created = await orgs.createOrganization({
        name: 'Slug Org',
        slug: 'slug-test',
        created_by: testUserId,
      })

      const org = await orgs.getOrganizationBySlug('slug-test')

      expect(org.id).toBe(created.id)
      expect(org.slug).toBe('slug-test')
    })

    it('should throw 404 for non-existent organization', async () => {
      await expect(orgs.getOrganization('org_nonexistent')).rejects.toThrow(ClerkAPIError)
    })

    it('should update organization', async () => {
      const created = await orgs.createOrganization({
        name: 'Original',
        created_by: testUserId,
      })

      const updated = await orgs.updateOrganization(created.id, {
        name: 'Updated',
        max_allowed_memberships: 50,
      })

      expect(updated.name).toBe('Updated')
      expect(updated.max_allowed_memberships).toBe(50)
    })

    it('should update organization metadata', async () => {
      const created = await orgs.createOrganization({
        name: 'Meta Org',
        created_by: testUserId,
      })

      const updated = await orgs.updateOrganizationMetadata(created.id, {
        public_metadata: { updated: true },
        private_metadata: { secret: 'value' },
      })

      expect(updated.public_metadata).toEqual({ updated: true })
      expect(updated.private_metadata).toEqual({ secret: 'value' })
    })

    it('should delete organization', async () => {
      const created = await orgs.createOrganization({
        name: 'Delete Org',
        created_by: testUserId,
      })

      const result = await orgs.deleteOrganization(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)

      await expect(orgs.getOrganization(created.id)).rejects.toThrow(ClerkAPIError)
    })

    it('should reject duplicate slugs', async () => {
      await orgs.createOrganization({
        name: 'First Org',
        slug: 'unique-slug',
        created_by: testUserId,
      })

      await expect(
        orgs.createOrganization({
          name: 'Second Org',
          slug: 'unique-slug',
          created_by: testUserId,
        })
      ).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('Organization Membership', () => {
    let orgId: string
    let memberId: string

    beforeEach(async () => {
      const org = await orgs.createOrganization({
        name: 'Membership Org',
        created_by: testUserId,
      })
      orgId = org.id

      const member = await userManager.createUser({
        email: 'member@example.com',
        password: 'Test123!@#',
        first_name: 'Member',
        last_name: 'User',
      })
      memberId = member.id
    })

    it('should list memberships', async () => {
      const result = await orgs.getOrganizationMembershipList({ organizationId: orgId })

      expect(result.total_count).toBe(1)
      expect(result.data[0].role).toBe('org:admin')
    })

    it('should create membership', async () => {
      const membership = await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      expect(membership).toBeDefined()
      expect(membership.object).toBe('organization_membership')
      expect(membership.role).toBe('org:member')
      expect(membership.public_user_data.user_id).toBe(memberId)
    })

    it('should update membership role', async () => {
      await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      const updated = await orgs.updateOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:admin',
      })

      expect(updated.role).toBe('org:admin')
    })

    it('should update membership metadata', async () => {
      await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      const updated = await orgs.updateOrganizationMembershipMetadata({
        organizationId: orgId,
        userId: memberId,
        public_metadata: { department: 'engineering' },
      })

      expect(updated.public_metadata).toEqual({ department: 'engineering' })
    })

    it('should delete membership', async () => {
      await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      const result = await orgs.deleteOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
      })

      expect(result.deleted).toBe(true)
    })

    it('should reject duplicate membership', async () => {
      await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      await expect(
        orgs.createOrganizationMembership({
          organizationId: orgId,
          userId: memberId,
          role: 'org:member',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should filter memberships by role', async () => {
      await orgs.createOrganizationMembership({
        organizationId: orgId,
        userId: memberId,
        role: 'org:member',
      })

      const admins = await orgs.getOrganizationMembershipList({
        organizationId: orgId,
        role: ['org:admin'],
      })

      expect(admins.total_count).toBe(1)

      const members = await orgs.getOrganizationMembershipList({
        organizationId: orgId,
        role: ['org:member'],
      })

      expect(members.total_count).toBe(1)
    })
  })

  describe('Organization Invitations', () => {
    let orgId: string

    beforeEach(async () => {
      const org = await orgs.createOrganization({
        name: 'Invite Org',
        created_by: testUserId,
      })
      orgId = org.id
    })

    it('should create invitation', async () => {
      const invitation = await orgs.createOrganizationInvitation(orgId, {
        email_address: 'invited@example.com',
        role: 'org:member',
        inviter_user_id: testUserId,
      })

      expect(invitation).toBeDefined()
      expect(invitation.object).toBe('organization_invitation')
      expect(invitation.email_address).toBe('invited@example.com')
      expect(invitation.role).toBe('org:member')
      expect(invitation.status).toBe('pending')
    })

    it('should list invitations', async () => {
      await orgs.createOrganizationInvitation(orgId, {
        email_address: 'invite1@example.com',
        role: 'org:member',
      })

      await orgs.createOrganizationInvitation(orgId, {
        email_address: 'invite2@example.com',
        role: 'org:admin',
      })

      const result = await orgs.getOrganizationInvitationList({ organizationId: orgId })

      expect(result.total_count).toBe(2)
    })

    it('should get invitation by ID', async () => {
      const created = await orgs.createOrganizationInvitation(orgId, {
        email_address: 'get@example.com',
        role: 'org:member',
      })

      const invitation = await orgs.getOrganizationInvitation({
        organizationId: orgId,
        invitationId: created.id,
      })

      expect(invitation.id).toBe(created.id)
    })

    it('should revoke invitation', async () => {
      const created = await orgs.createOrganizationInvitation(orgId, {
        email_address: 'revoke@example.com',
        role: 'org:member',
      })

      const revoked = await orgs.revokeOrganizationInvitation({
        organizationId: orgId,
        invitationId: created.id,
      })

      expect(revoked.status).toBe('revoked')
    })

    it('should filter invitations by status', async () => {
      const inv1 = await orgs.createOrganizationInvitation(orgId, {
        email_address: 'status1@example.com',
        role: 'org:member',
      })

      await orgs.createOrganizationInvitation(orgId, {
        email_address: 'status2@example.com',
        role: 'org:member',
      })

      await orgs.revokeOrganizationInvitation({
        organizationId: orgId,
        invitationId: inv1.id,
      })

      const pending = await orgs.getOrganizationInvitationList({
        organizationId: orgId,
        status: 'pending',
      })

      expect(pending.total_count).toBe(1)

      const revoked = await orgs.getOrganizationInvitationList({
        organizationId: orgId,
        status: 'revoked',
      })

      expect(revoked.total_count).toBe(1)
    })

    it('should reject duplicate pending invitations', async () => {
      await orgs.createOrganizationInvitation(orgId, {
        email_address: 'duplicate@example.com',
        role: 'org:member',
      })

      await expect(
        orgs.createOrganizationInvitation(orgId, {
          email_address: 'duplicate@example.com',
          role: 'org:admin',
        })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should create bulk invitations', async () => {
      const result = await orgs.createBulkOrganizationInvitations(orgId, [
        { email_address: 'bulk1@example.com', role: 'org:member' },
        { email_address: 'bulk2@example.com', role: 'org:member' },
        { email_address: 'bulk3@example.com', role: 'org:admin' },
      ])

      expect(result.total_count).toBe(3)
    })

    it('should get pending invitations by email', async () => {
      await orgs.createOrganizationInvitation(orgId, {
        email_address: 'pending@example.com',
        role: 'org:member',
      })

      const result = await orgs.getPendingOrganizationInvitationList({
        user_email_address: 'pending@example.com',
      })

      expect(result.total_count).toBe(1)
    })
  })

  describe('Organization Roles', () => {
    it('should list default roles', async () => {
      const result = await orgs.getOrganizationRoleList()

      expect(result.total_count).toBeGreaterThanOrEqual(2)
      expect(result.data.find((r) => r.key === 'org:admin')).toBeDefined()
      expect(result.data.find((r) => r.key === 'org:member')).toBeDefined()
    })

    it('should get role by ID', async () => {
      const role = await orgs.getOrganizationRole('role_admin')

      expect(role.key).toBe('org:admin')
      expect(role.permissions).toContain('org:sys_profile:manage')
    })

    it('should create custom role', async () => {
      const role = await orgs.createOrganizationRole({
        name: 'Manager',
        key: 'org:manager',
        description: 'Team manager with limited admin access',
        permissions: ['org:sys_profile:read', 'org:sys_memberships:read', 'org:sys_memberships:manage'],
      })

      expect(role).toBeDefined()
      expect(role.object).toBe('role')
      expect(role.name).toBe('Manager')
      expect(role.key).toBe('org:manager')
    })

    it('should update custom role', async () => {
      const created = await orgs.createOrganizationRole({
        name: 'Editor',
        key: 'org:editor',
      })

      const updated = await orgs.updateOrganizationRole(created.id, {
        name: 'Senior Editor',
        permissions: ['org:sys_profile:read'],
      })

      expect(updated.name).toBe('Senior Editor')
      expect(updated.permissions).toContain('org:sys_profile:read')
    })

    it('should delete custom role', async () => {
      const created = await orgs.createOrganizationRole({
        name: 'Temp Role',
        key: 'org:temp',
      })

      const result = await orgs.deleteOrganizationRole(created.id)

      expect(result.deleted).toBe(true)
    })

    it('should not delete system roles', async () => {
      await expect(orgs.deleteOrganizationRole('role_admin')).rejects.toThrow(ClerkAPIError)
      await expect(orgs.deleteOrganizationRole('role_member')).rejects.toThrow(ClerkAPIError)
    })

    it('should assign permission to role', async () => {
      const role = await orgs.createOrganizationRole({
        name: 'Viewer',
        key: 'org:viewer',
        permissions: [],
      })

      const updated = await orgs.assignPermissionToRole(role.id, 'perm_sys_profile_read')

      expect(updated.permissions).toContain('org:sys_profile:read')
    })

    it('should remove permission from role', async () => {
      const role = await orgs.createOrganizationRole({
        name: 'Limited',
        key: 'org:limited',
        permissions: ['org:sys_profile:read', 'org:sys_memberships:read'],
      })

      const updated = await orgs.removePermissionFromRole(role.id, 'perm_sys_memberships_read')

      expect(updated.permissions).not.toContain('org:sys_memberships:read')
      expect(updated.permissions).toContain('org:sys_profile:read')
    })
  })

  describe('Organization Permissions', () => {
    it('should list system permissions', async () => {
      const result = await orgs.getOrganizationPermissionList()

      expect(result.total_count).toBeGreaterThanOrEqual(7)
      expect(result.data.find((p) => p.key === 'org:sys_profile:read')).toBeDefined()
      expect(result.data.find((p) => p.key === 'org:sys_memberships:manage')).toBeDefined()
    })

    it('should get permission by ID', async () => {
      const permission = await orgs.getOrganizationPermission('perm_sys_profile_read')

      expect(permission.key).toBe('org:sys_profile:read')
      expect(permission.type).toBe('system')
    })

    it('should create custom permission', async () => {
      const permission = await orgs.createOrganizationPermission({
        name: 'Manage Projects',
        key: 'org:projects:manage',
        description: 'Create, update, and delete projects',
      })

      expect(permission).toBeDefined()
      expect(permission.object).toBe('permission')
      expect(permission.type).toBe('custom')
    })

    it('should update custom permission', async () => {
      const created = await orgs.createOrganizationPermission({
        name: 'View Reports',
        key: 'org:reports:view',
      })

      const updated = await orgs.updateOrganizationPermission(created.id, {
        name: 'View All Reports',
        description: 'Access to all reporting features',
      })

      expect(updated.name).toBe('View All Reports')
    })

    it('should delete custom permission', async () => {
      const created = await orgs.createOrganizationPermission({
        name: 'Temp Permission',
        key: 'org:temp:perm',
      })

      const result = await orgs.deleteOrganizationPermission(created.id)

      expect(result.deleted).toBe(true)
    })

    it('should not delete system permissions', async () => {
      await expect(orgs.deleteOrganizationPermission('perm_sys_profile_read')).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('Organization Domains', () => {
    let orgId: string

    beforeEach(async () => {
      const org = await orgs.createOrganization({
        name: 'Domain Org',
        created_by: testUserId,
      })
      orgId = org.id
    })

    it('should create domain', async () => {
      const domain = await orgs.createOrganizationDomain(orgId, {
        name: 'example.com',
      })

      expect(domain).toBeDefined()
      expect(domain.object).toBe('organization_domain')
      expect(domain.name).toBe('example.com')
      expect(domain.enrollment_mode).toBe('manual_invitation')
    })

    it('should create verified domain', async () => {
      const domain = await orgs.createOrganizationDomain(orgId, {
        name: 'verified.com',
        verified: true,
      })

      expect(domain.verification?.status).toBe('verified')
    })

    it('should create domain with enrollment mode', async () => {
      const domain = await orgs.createOrganizationDomain(orgId, {
        name: 'auto.com',
        enrollment_mode: 'automatic_invitation',
      })

      expect(domain.enrollment_mode).toBe('automatic_invitation')
    })

    it('should list domains', async () => {
      await orgs.createOrganizationDomain(orgId, { name: 'domain1.com' })
      await orgs.createOrganizationDomain(orgId, { name: 'domain2.com' })

      const result = await orgs.getOrganizationDomainList({ organizationId: orgId })

      expect(result.total_count).toBe(2)
    })

    it('should get domain by ID', async () => {
      const created = await orgs.createOrganizationDomain(orgId, {
        name: 'get.com',
      })

      const domain = await orgs.getOrganizationDomain({
        organizationId: orgId,
        domainId: created.id,
      })

      expect(domain.id).toBe(created.id)
    })

    it('should update domain enrollment mode', async () => {
      const created = await orgs.createOrganizationDomain(orgId, {
        name: 'update.com',
      })

      const updated = await orgs.updateOrganizationDomain({
        organizationId: orgId,
        domainId: created.id,
        enrollment_mode: 'automatic_suggestion',
      })

      expect(updated.enrollment_mode).toBe('automatic_suggestion')
    })

    it('should delete domain', async () => {
      const created = await orgs.createOrganizationDomain(orgId, {
        name: 'delete.com',
      })

      const result = await orgs.deleteOrganizationDomain({
        organizationId: orgId,
        domainId: created.id,
      })

      expect(result.deleted).toBe(true)
    })

    it('should prepare domain verification', async () => {
      const created = await orgs.createOrganizationDomain(orgId, {
        name: 'verify.com',
      })

      const prepared = await orgs.prepareOrganizationDomainVerification({
        organizationId: orgId,
        domainId: created.id,
        strategy: 'email_code',
        affiliation_email_address: 'admin@verify.com',
      })

      expect(prepared.verification?.status).toBe('unverified')
      expect(prepared.verification?.strategy).toBe('email_code')
      expect(prepared.affiliation_email_address).toBe('admin@verify.com')
    })

    it('should verify domain', async () => {
      const created = await orgs.createOrganizationDomain(orgId, {
        name: 'toverify.com',
      })

      await orgs.prepareOrganizationDomainVerification({
        organizationId: orgId,
        domainId: created.id,
        strategy: 'email_code',
      })

      const verified = await orgs.verifyOrganizationDomain({
        organizationId: orgId,
        domainId: created.id,
      })

      expect(verified.verification?.status).toBe('verified')
    })

    it('should reject duplicate domains', async () => {
      await orgs.createOrganizationDomain(orgId, { name: 'unique.com' })

      const org2 = await orgs.createOrganization({
        name: 'Other Org',
        created_by: testUserId,
      })

      await expect(
        orgs.createOrganizationDomain(org2.id, { name: 'unique.com' })
      ).rejects.toThrow(ClerkAPIError)
    })

    it('should filter domains by verification status', async () => {
      await orgs.createOrganizationDomain(orgId, { name: 'unverified.com' })
      await orgs.createOrganizationDomain(orgId, {
        name: 'verified.com',
        verified: true,
      })

      const verified = await orgs.getOrganizationDomainList({
        organizationId: orgId,
        verified: true,
      })

      expect(verified.total_count).toBe(1)

      const unverified = await orgs.getOrganizationDomainList({
        organizationId: orgId,
        verified: false,
      })

      expect(unverified.total_count).toBe(1)
    })
  })

  describe('Organization Logo', () => {
    it('should update organization logo', async () => {
      const org = await orgs.createOrganization({
        name: 'Logo Org',
        created_by: testUserId,
      })

      const updated = await orgs.updateOrganizationLogo(org.id, {
        url: 'https://example.com/logo.png',
      })

      expect(updated.image_url).toBe('https://example.com/logo.png')
      expect(updated.has_image).toBe(true)
    })

    it('should delete organization logo', async () => {
      const org = await orgs.createOrganization({
        name: 'Delete Logo Org',
        created_by: testUserId,
      })

      await orgs.updateOrganizationLogo(org.id, {
        url: 'https://example.com/logo.png',
      })

      const updated = await orgs.deleteOrganizationLogo(org.id)

      expect(updated.image_url).toBe('')
      expect(updated.has_image).toBe(false)
    })
  })
})
