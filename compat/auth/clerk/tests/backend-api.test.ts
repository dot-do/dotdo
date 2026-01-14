/**
 * Clerk Backend API Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Clerk, createClerkClient, ClerkAPIError } from '../index'

describe('Clerk Backend API', () => {
  let clerk: Clerk

  beforeEach(() => {
    clerk = createClerkClient({
      secretKey: 'sk_test_secret_key_at_least_32_chars',
      publishableKey: 'pk_test_publishable',
    })
  })

  describe('users', () => {
    it('should create a user', async () => {
      const user = await clerk.users.createUser({
        email_address: ['test@example.com'],
        password: 'Test123!@#',
        first_name: 'John',
        last_name: 'Doe',
      })

      expect(user).toBeDefined()
      expect(user.id).toBeDefined()
      expect(user.object).toBe('user')
      expect(user.first_name).toBe('John')
      expect(user.last_name).toBe('Doe')
      expect(user.email_addresses).toHaveLength(1)
      expect(user.email_addresses[0].email_address).toBe('test@example.com')
    })

    it('should create a user with metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: ['meta@example.com'],
        password: 'Test123!@#',
        public_metadata: { theme: 'dark' },
        private_metadata: { internal_id: '123' },
        unsafe_metadata: { preference: 'test' },
      })

      expect(user.public_metadata).toEqual({ theme: 'dark' })
    })

    it('should create a user with username', async () => {
      const user = await clerk.users.createUser({
        email_address: ['username@example.com'],
        password: 'Test123!@#',
        username: 'testuser',
      })

      expect(user.username).toBe('testuser')
    })

    it('should get a user by ID', async () => {
      const created = await clerk.users.createUser({
        email_address: ['get@example.com'],
        password: 'Test123!@#',
      })

      const user = await clerk.users.getUser(created.id)

      expect(user.id).toBe(created.id)
      expect(user.email_addresses[0].email_address).toBe('get@example.com')
    })

    it('should throw 404 for non-existent user', async () => {
      await expect(clerk.users.getUser('user_nonexistent')).rejects.toThrow(ClerkAPIError)
    })

    it('should get users by email', async () => {
      await clerk.users.createUser({
        email_address: ['search@example.com'],
        password: 'Test123!@#',
      })

      const result = await clerk.users.getUserList({
        email_address: ['search@example.com'],
      })

      expect(result.data).toHaveLength(1)
      expect(result.data[0].email_addresses[0].email_address).toBe('search@example.com')
    })

    it('should get users by ID', async () => {
      const user1 = await clerk.users.createUser({
        email_address: ['id1@example.com'],
        password: 'Test123!@#',
      })

      const user2 = await clerk.users.createUser({
        email_address: ['id2@example.com'],
        password: 'Test123!@#',
      })

      const result = await clerk.users.getUserList({
        user_id: [user1.id, user2.id],
      })

      expect(result.data).toHaveLength(2)
    })

    it('should update a user', async () => {
      const created = await clerk.users.createUser({
        email_address: ['update@example.com'],
        password: 'Test123!@#',
        first_name: 'Original',
      })

      const updated = await clerk.users.updateUser(created.id, {
        first_name: 'Updated',
        last_name: 'Name',
        public_metadata: { updated: true },
      })

      expect(updated.first_name).toBe('Updated')
      expect(updated.last_name).toBe('Name')
      expect(updated.public_metadata).toEqual({ updated: true })
    })

    it('should delete a user', async () => {
      const created = await clerk.users.createUser({
        email_address: ['delete@example.com'],
        password: 'Test123!@#',
      })

      const result = await clerk.users.deleteUser(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)

      await expect(clerk.users.getUser(created.id)).rejects.toThrow(ClerkAPIError)
    })

    it('should ban and unban a user', async () => {
      const created = await clerk.users.createUser({
        email_address: ['ban@example.com'],
        password: 'Test123!@#',
      })

      const banned = await clerk.users.banUser(created.id)
      expect(banned.banned).toBe(true)

      const unbanned = await clerk.users.unbanUser(created.id)
      expect(unbanned.banned).toBe(false)
    })

    it('should lock and unlock a user', async () => {
      const created = await clerk.users.createUser({
        email_address: ['lock@example.com'],
        password: 'Test123!@#',
      })

      const locked = await clerk.users.lockUser(created.id)
      expect(locked.locked).toBe(true)

      const unlocked = await clerk.users.unlockUser(created.id)
      expect(unlocked.locked).toBe(false)
    })

    it('should verify password', async () => {
      const created = await clerk.users.createUser({
        email_address: ['verify@example.com'],
        password: 'Test123!@#',
      })

      const valid = await clerk.users.verifyPassword({
        userId: created.id,
        password: 'Test123!@#',
      })

      expect(valid.verified).toBe(true)

      const invalid = await clerk.users.verifyPassword({
        userId: created.id,
        password: 'WrongPassword',
      })

      expect(invalid.verified).toBe(false)
    })
  })

  describe('organizations', () => {
    it('should create an organization', async () => {
      const user = await clerk.users.createUser({
        email_address: ['org-creator@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Acme Inc',
        created_by: user.id,
      })

      expect(org).toBeDefined()
      expect(org.id).toBeDefined()
      expect(org.object).toBe('organization')
      expect(org.name).toBe('Acme Inc')
      expect(org.slug).toBe('acme-inc')
      expect(org.members_count).toBe(1) // Creator is auto-added
    })

    it('should create organization with custom slug', async () => {
      const user = await clerk.users.createUser({
        email_address: ['slug-creator@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Acme Inc',
        slug: 'acme',
        created_by: user.id,
      })

      expect(org.slug).toBe('acme')
    })

    it('should create organization with metadata', async () => {
      const user = await clerk.users.createUser({
        email_address: ['meta-org@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Meta Org',
        created_by: user.id,
        public_metadata: { tier: 'enterprise' },
        private_metadata: { internal: true },
      })

      expect(org.public_metadata).toEqual({ tier: 'enterprise' })
      expect(org.private_metadata).toEqual({ internal: true })
    })

    it('should get an organization by ID', async () => {
      const user = await clerk.users.createUser({
        email_address: ['get-org@example.com'],
        password: 'Test123!@#',
      })

      const created = await clerk.organizations.createOrganization({
        name: 'Get Org',
        created_by: user.id,
      })

      const org = await clerk.organizations.getOrganization(created.id)

      expect(org.id).toBe(created.id)
      expect(org.name).toBe('Get Org')
    })

    it('should throw 404 for non-existent organization', async () => {
      await expect(clerk.organizations.getOrganization('org_nonexistent')).rejects.toThrow(ClerkAPIError)
    })

    it('should update an organization', async () => {
      const user = await clerk.users.createUser({
        email_address: ['update-org@example.com'],
        password: 'Test123!@#',
      })

      const created = await clerk.organizations.createOrganization({
        name: 'Original Org',
        created_by: user.id,
      })

      const updated = await clerk.organizations.updateOrganization(created.id, {
        name: 'Updated Org',
        max_allowed_memberships: 50,
      })

      expect(updated.name).toBe('Updated Org')
      expect(updated.max_allowed_memberships).toBe(50)
    })

    it('should delete an organization', async () => {
      const user = await clerk.users.createUser({
        email_address: ['delete-org@example.com'],
        password: 'Test123!@#',
      })

      const created = await clerk.organizations.createOrganization({
        name: 'Delete Org',
        created_by: user.id,
      })

      const result = await clerk.organizations.deleteOrganization(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)
    })

    it('should create organization membership', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['org-owner@example.com'],
        password: 'Test123!@#',
      })

      const member = await clerk.users.createUser({
        email_address: ['org-member@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Member Org',
        created_by: creator.id,
      })

      const membership = await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
        role: 'member',
      })

      expect(membership).toBeDefined()
      expect(membership.object).toBe('organization_membership')
      expect(membership.role).toBe('member')
      expect(membership.public_user_data.user_id).toBe(member.id)
    })

    it('should get organization memberships', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['membership-owner@example.com'],
        password: 'Test123!@#',
      })

      const member = await clerk.users.createUser({
        email_address: ['membership-member@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Membership Org',
        created_by: creator.id,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
        role: 'member',
      })

      const result = await clerk.organizations.getOrganizationMembershipList({
        organizationId: org.id,
      })

      expect(result.total_count).toBe(2) // Creator + member
    })

    it('should update organization membership', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['update-mem-owner@example.com'],
        password: 'Test123!@#',
      })

      const member = await clerk.users.createUser({
        email_address: ['update-mem-member@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Update Membership Org',
        created_by: creator.id,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
        role: 'member',
      })

      const updated = await clerk.organizations.updateOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
        role: 'admin',
      })

      expect(updated.role).toBe('admin')
    })

    it('should delete organization membership', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['delete-mem-owner@example.com'],
        password: 'Test123!@#',
      })

      const member = await clerk.users.createUser({
        email_address: ['delete-mem-member@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Delete Membership Org',
        created_by: creator.id,
      })

      await clerk.organizations.createOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
        role: 'member',
      })

      const result = await clerk.organizations.deleteOrganizationMembership({
        organizationId: org.id,
        userId: member.id,
      })

      expect(result.deleted).toBe(true)
    })

    it('should create organization invitation', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['invite-owner@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Invite Org',
        created_by: creator.id,
      })

      const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'invited@example.com',
        role: 'member',
        inviter_user_id: creator.id,
      })

      expect(invitation).toBeDefined()
      expect(invitation.object).toBe('organization_invitation')
      expect(invitation.email_address).toBe('invited@example.com')
      expect(invitation.role).toBe('member')
      expect(invitation.status).toBe('pending')
    })

    it('should revoke organization invitation', async () => {
      const creator = await clerk.users.createUser({
        email_address: ['revoke-invite-owner@example.com'],
        password: 'Test123!@#',
      })

      const org = await clerk.organizations.createOrganization({
        name: 'Revoke Invite Org',
        created_by: creator.id,
      })

      const invitation = await clerk.organizations.createOrganizationInvitation(org.id, {
        email_address: 'revoke-invited@example.com',
        role: 'member',
        inviter_user_id: creator.id,
      })

      const revoked = await clerk.organizations.revokeOrganizationInvitation({
        organizationId: org.id,
        invitationId: invitation.id,
      })

      expect(revoked.status).toBe('revoked')
    })

    it('should get user organization memberships', async () => {
      const user = await clerk.users.createUser({
        email_address: ['multi-org@example.com'],
        password: 'Test123!@#',
      })

      await clerk.organizations.createOrganization({
        name: 'Org 1',
        created_by: user.id,
      })

      await clerk.organizations.createOrganization({
        name: 'Org 2',
        created_by: user.id,
      })

      const result = await clerk.users.getOrganizationMembershipList({
        userId: user.id,
      })

      expect(result.total_count).toBe(2)
    })
  })

  describe('jwtTemplates', () => {
    it('should create a JWT template', async () => {
      const template = await clerk.jwtTemplates.createJWTTemplate({
        name: 'test-template',
        claims: {
          role: 'authenticated',
          aud: 'https://api.example.com',
        },
        lifetime: 3600,
      })

      expect(template).toBeDefined()
      expect(template.id).toBeDefined()
      expect(template.object).toBe('jwt_template')
      expect(template.name).toBe('test-template')
      expect(template.claims).toEqual({
        role: 'authenticated',
        aud: 'https://api.example.com',
      })
      expect(template.lifetime).toBe(3600)
    })

    it('should get a JWT template by ID', async () => {
      const created = await clerk.jwtTemplates.createJWTTemplate({
        name: 'get-template',
        claims: { test: true },
      })

      const template = await clerk.jwtTemplates.getJWTTemplate(created.id)

      expect(template.id).toBe(created.id)
      expect(template.name).toBe('get-template')
    })

    it('should throw 404 for non-existent template', async () => {
      await expect(clerk.jwtTemplates.getJWTTemplate('jwt_nonexistent')).rejects.toThrow(ClerkAPIError)
    })

    it('should update a JWT template', async () => {
      const created = await clerk.jwtTemplates.createJWTTemplate({
        name: 'update-template',
        claims: { version: 1 },
        lifetime: 60,
      })

      const updated = await clerk.jwtTemplates.updateJWTTemplate(created.id, {
        claims: { version: 2 },
        lifetime: 120,
      })

      expect(updated.claims).toEqual({ version: 2 })
      expect(updated.lifetime).toBe(120)
    })

    it('should delete a JWT template', async () => {
      const created = await clerk.jwtTemplates.createJWTTemplate({
        name: 'delete-template',
        claims: {},
      })

      const result = await clerk.jwtTemplates.deleteJWTTemplate(created.id)

      expect(result.deleted).toBe(true)
      expect(result.id).toBe(created.id)

      await expect(clerk.jwtTemplates.getJWTTemplate(created.id)).rejects.toThrow(ClerkAPIError)
    })
  })

  describe('sessions', () => {
    // Note: Session tests require more setup since sessions are created during authentication
    // These tests verify the API structure

    it('should throw 404 for non-existent session', async () => {
      await expect(clerk.sessions.getSession('sess_nonexistent')).rejects.toThrow(ClerkAPIError)
    })

    it('should return empty list for user with no sessions', async () => {
      const result = await clerk.sessions.getSessionList({
        user_id: 'user_nonexistent',
      })

      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })

  describe('verifyToken', () => {
    it('should reject invalid token', async () => {
      await expect(clerk.verifyToken('invalid-token')).rejects.toThrow(ClerkAPIError)
    })

    it('should reject token with wrong format', async () => {
      await expect(clerk.verifyToken('not.a.jwt')).rejects.toThrow(ClerkAPIError)
    })
  })
})
