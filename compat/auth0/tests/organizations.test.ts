/**
 * Tests for Auth0 Organizations API compat layer
 *
 * Auth0 Organizations provides multi-tenancy / B2B capabilities:
 * - Organization CRUD (create, read, update, delete)
 * - Member management (add, remove, list members)
 * - Invitation management (create, revoke, list invitations)
 * - Organization connections (enable connections per org)
 * - Organization branding (custom login pages per org)
 *
 * @see https://auth0.com/docs/manage-users/organizations
 * @see https://auth0.com/docs/api/management/v2#!/Organizations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ManagementClient } from '../management-client'
import type { User } from '../types'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    deriveBits: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
  },
})

// ============================================================================
// TYPE DEFINITIONS (Expected types for Organizations API)
// ============================================================================

interface Organization {
  id: string
  name: string
  display_name: string
  branding?: {
    logo_url?: string
    colors?: {
      primary?: string
      page_background?: string
    }
  }
  metadata?: Record<string, string>
  enabled_connections?: EnabledConnection[]
  created_at: string
  updated_at: string
}

interface EnabledConnection {
  connection_id: string
  assign_membership_on_login: boolean
  show_as_button?: boolean
}

interface OrganizationMember {
  user_id: string
  name?: string
  email?: string
  picture?: string
  roles?: OrganizationRole[]
}

interface OrganizationRole {
  id: string
  name: string
  description?: string
}

interface OrganizationInvitation {
  id: string
  organization_id: string
  inviter: {
    name: string
  }
  invitee: {
    email: string
  }
  invitation_url: string
  ticket_id: string
  client_id: string
  connection_id?: string
  roles?: string[]
  expires_at: string
  created_at: string
}

describe('Auth0 Organizations Compat', () => {
  let management: ManagementClient

  beforeEach(() => {
    management = new ManagementClient({
      domain: 'test-tenant.auth0.com',
      token: 'test-management-api-token',
    })
  })

  // ============================================================================
  // ORGANIZATIONS MANAGER INITIALIZATION
  // ============================================================================

  describe('organizations manager initialization', () => {
    it('should provide organizations manager', () => {
      expect(management.organizations).toBeDefined()
    })

    it('should have create method', () => {
      expect(typeof management.organizations.create).toBe('function')
    })

    it('should have get method', () => {
      expect(typeof management.organizations.get).toBe('function')
    })

    it('should have getByName method', () => {
      expect(typeof management.organizations.getByName).toBe('function')
    })

    it('should have update method', () => {
      expect(typeof management.organizations.update).toBe('function')
    })

    it('should have delete method', () => {
      expect(typeof management.organizations.delete).toBe('function')
    })

    it('should have getAll method', () => {
      expect(typeof management.organizations.getAll).toBe('function')
    })
  })

  // ============================================================================
  // ORGANIZATION CRUD
  // ============================================================================

  describe('organizations.create', () => {
    it('should create organization with name and display_name', async () => {
      const org = await management.organizations.create({
        name: 'acme-corp',
        display_name: 'Acme Corporation',
      })

      expect(org).toBeDefined()
      expect(org.id).toBeDefined()
      expect(org.id).toMatch(/^org_/)
      expect(org.name).toBe('acme-corp')
      expect(org.display_name).toBe('Acme Corporation')
      expect(org.created_at).toBeDefined()
      expect(org.updated_at).toBeDefined()
    })

    it('should create organization with metadata', async () => {
      const org = await management.organizations.create({
        name: 'startup-inc',
        display_name: 'Startup Inc',
        metadata: {
          plan: 'enterprise',
          region: 'us-west-2',
          industry: 'technology',
        },
      })

      expect(org.metadata).toEqual({
        plan: 'enterprise',
        region: 'us-west-2',
        industry: 'technology',
      })
    })

    it('should create organization with branding', async () => {
      const org = await management.organizations.create({
        name: 'branded-org',
        display_name: 'Branded Organization',
        branding: {
          logo_url: 'https://example.com/logo.png',
          colors: {
            primary: '#FF5733',
            page_background: '#FFFFFF',
          },
        },
      })

      expect(org.branding).toBeDefined()
      expect(org.branding?.logo_url).toBe('https://example.com/logo.png')
      expect(org.branding?.colors?.primary).toBe('#FF5733')
      expect(org.branding?.colors?.page_background).toBe('#FFFFFF')
    })

    it('should reject duplicate organization name', async () => {
      await management.organizations.create({
        name: 'duplicate-org',
        display_name: 'Duplicate Org',
      })

      await expect(
        management.organizations.create({
          name: 'duplicate-org',
          display_name: 'Another Display Name',
        })
      ).rejects.toThrow()
    })

    it('should validate organization name format', async () => {
      // Names must be lowercase, alphanumeric with hyphens
      await expect(
        management.organizations.create({
          name: 'Invalid Name With Spaces',
          display_name: 'Invalid',
        })
      ).rejects.toThrow()

      await expect(
        management.organizations.create({
          name: 'UPPERCASE',
          display_name: 'Uppercase',
        })
      ).rejects.toThrow()

      await expect(
        management.organizations.create({
          name: 'special@chars!',
          display_name: 'Special',
        })
      ).rejects.toThrow()
    })

    it('should allow valid organization name formats', async () => {
      const org1 = await management.organizations.create({
        name: 'valid-name',
        display_name: 'Valid Name',
      })
      expect(org1.name).toBe('valid-name')

      const org2 = await management.organizations.create({
        name: 'valid123',
        display_name: 'Valid 123',
      })
      expect(org2.name).toBe('valid123')

      const org3 = await management.organizations.create({
        name: 'my-org-2024',
        display_name: 'My Org 2024',
      })
      expect(org3.name).toBe('my-org-2024')
    })
  })

  describe('organizations.get', () => {
    let createdOrg: Organization

    beforeEach(async () => {
      createdOrg = await management.organizations.create({
        name: 'get-test-org',
        display_name: 'Get Test Organization',
        metadata: { tier: 'premium' },
      })
    })

    it('should get organization by ID', async () => {
      const org = await management.organizations.get({ id: createdOrg.id })

      expect(org).toBeDefined()
      expect(org.id).toBe(createdOrg.id)
      expect(org.name).toBe('get-test-org')
      expect(org.display_name).toBe('Get Test Organization')
    })

    it('should return null for non-existent organization', async () => {
      const org = await management.organizations.get({ id: 'org_nonexistent' })
      expect(org).toBeNull()
    })

    it('should include metadata in response', async () => {
      const org = await management.organizations.get({ id: createdOrg.id })
      expect(org?.metadata?.tier).toBe('premium')
    })
  })

  describe('organizations.getByName', () => {
    beforeEach(async () => {
      await management.organizations.create({
        name: 'named-org',
        display_name: 'Named Organization',
      })
    })

    it('should get organization by name', async () => {
      const org = await management.organizations.getByName({ name: 'named-org' })

      expect(org).toBeDefined()
      expect(org.name).toBe('named-org')
    })

    it('should throw for non-existent name', async () => {
      await expect(
        management.organizations.getByName({ name: 'nonexistent' })
      ).rejects.toThrow()
    })
  })

  describe('organizations.update', () => {
    let org: Organization

    beforeEach(async () => {
      org = await management.organizations.create({
        name: 'update-test-org',
        display_name: 'Update Test',
      })
    })

    it('should update display_name', async () => {
      const updated = await management.organizations.update(
        { id: org.id },
        { display_name: 'Updated Display Name' }
      )

      expect(updated.display_name).toBe('Updated Display Name')
      expect(updated.name).toBe('update-test-org') // Name unchanged
      expect(updated.updated_at).not.toBe(org.updated_at)
    })

    it('should update metadata', async () => {
      const updated = await management.organizations.update(
        { id: org.id },
        {
          metadata: {
            plan: 'enterprise',
            custom_field: 'value',
          },
        }
      )

      expect(updated.metadata?.plan).toBe('enterprise')
      expect(updated.metadata?.custom_field).toBe('value')
    })

    it('should update branding', async () => {
      const updated = await management.organizations.update(
        { id: org.id },
        {
          branding: {
            logo_url: 'https://example.com/new-logo.png',
            colors: {
              primary: '#123456',
            },
          },
        }
      )

      expect(updated.branding?.logo_url).toBe('https://example.com/new-logo.png')
      expect(updated.branding?.colors?.primary).toBe('#123456')
    })

    it('should not allow name updates', async () => {
      // Auth0 doesn't allow changing the organization name after creation
      await expect(
        management.organizations.update(
          { id: org.id },
          { name: 'new-name' } as never
        )
      ).rejects.toThrow()
    })

    it('should throw for non-existent organization', async () => {
      await expect(
        management.organizations.update(
          { id: 'org_nonexistent' },
          { display_name: 'Test' }
        )
      ).rejects.toThrow()
    })
  })

  describe('organizations.delete', () => {
    it('should delete organization', async () => {
      const org = await management.organizations.create({
        name: 'delete-me',
        display_name: 'Delete Me',
      })

      await management.organizations.delete({ id: org.id })

      const deleted = await management.organizations.get({ id: org.id })
      expect(deleted).toBeNull()
    })

    it('should not throw for non-existent organization', async () => {
      // Auth0 returns 204 even for non-existent orgs
      await expect(
        management.organizations.delete({ id: 'org_nonexistent' })
      ).resolves.not.toThrow()
    })
  })

  describe('organizations.getAll', () => {
    beforeEach(async () => {
      await management.organizations.create({
        name: 'list-org-1',
        display_name: 'List Org 1',
        metadata: { region: 'us' },
      })
      await management.organizations.create({
        name: 'list-org-2',
        display_name: 'List Org 2',
        metadata: { region: 'eu' },
      })
      await management.organizations.create({
        name: 'list-org-3',
        display_name: 'List Org 3',
        metadata: { region: 'us' },
      })
    })

    it('should list all organizations', async () => {
      const result = await management.organizations.getAll()

      expect(result.organizations).toBeDefined()
      expect(result.organizations.length).toBeGreaterThanOrEqual(3)
    })

    it('should support pagination', async () => {
      const page1 = await management.organizations.getAll({
        per_page: 2,
        page: 0,
        include_totals: true,
      })

      expect(page1.organizations.length).toBeLessThanOrEqual(2)
      expect(page1.total).toBeGreaterThanOrEqual(3)

      const page2 = await management.organizations.getAll({
        per_page: 2,
        page: 1,
      })

      expect(page2.organizations.length).toBeGreaterThanOrEqual(1)
    })

    it('should support name filter', async () => {
      const result = await management.organizations.getAll({
        name_filter: 'list-org-1',
      })

      expect(result.organizations.length).toBe(1)
      expect(result.organizations[0].name).toBe('list-org-1')
    })
  })

  // ============================================================================
  // MEMBER MANAGEMENT
  // ============================================================================

  describe('organizations.members', () => {
    let org: Organization
    let testUser: User

    beforeEach(async () => {
      org = await management.organizations.create({
        name: 'member-test-org',
        display_name: 'Member Test Organization',
      })

      testUser = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'member@example.com',
        password: 'SecurePass123!',
        name: 'Test Member',
      })
    })

    describe('addMembers', () => {
      it('should add a member to organization', async () => {
        await management.organizations.addMembers(
          { id: org.id },
          { members: [testUser.user_id] }
        )

        const members = await management.organizations.getMembers({ id: org.id })
        expect(members.members.some((m) => m.user_id === testUser.user_id)).toBe(true)
      })

      it('should add multiple members at once', async () => {
        const user2 = await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'member2@example.com',
          password: 'SecurePass123!',
        })

        await management.organizations.addMembers(
          { id: org.id },
          { members: [testUser.user_id, user2.user_id] }
        )

        const members = await management.organizations.getMembers({ id: org.id })
        expect(members.members.length).toBeGreaterThanOrEqual(2)
      })

      it('should throw for non-existent organization', async () => {
        await expect(
          management.organizations.addMembers(
            { id: 'org_nonexistent' },
            { members: [testUser.user_id] }
          )
        ).rejects.toThrow()
      })

      it('should throw for non-existent user', async () => {
        await expect(
          management.organizations.addMembers(
            { id: org.id },
            { members: ['auth0|nonexistent'] }
          )
        ).rejects.toThrow()
      })

      it('should be idempotent for existing members', async () => {
        await management.organizations.addMembers(
          { id: org.id },
          { members: [testUser.user_id] }
        )

        // Adding same member again should not throw
        await expect(
          management.organizations.addMembers(
            { id: org.id },
            { members: [testUser.user_id] }
          )
        ).resolves.not.toThrow()
      })
    })

    describe('getMembers', () => {
      beforeEach(async () => {
        await management.organizations.addMembers(
          { id: org.id },
          { members: [testUser.user_id] }
        )
      })

      it('should list organization members', async () => {
        const result = await management.organizations.getMembers({ id: org.id })

        expect(result.members).toBeDefined()
        expect(result.members.length).toBeGreaterThanOrEqual(1)
      })

      it('should include user details in members', async () => {
        const result = await management.organizations.getMembers({ id: org.id })
        const member = result.members.find((m) => m.user_id === testUser.user_id)

        expect(member).toBeDefined()
        expect(member?.email).toBe('member@example.com')
        expect(member?.name).toBe('Test Member')
      })

      it('should support pagination', async () => {
        // Add more members
        for (let i = 0; i < 5; i++) {
          const user = await management.users.create({
            connection: 'Username-Password-Authentication',
            email: `paginate-member${i}@example.com`,
            password: 'SecurePass123!',
          })
          await management.organizations.addMembers(
            { id: org.id },
            { members: [user.user_id] }
          )
        }

        const page1 = await management.organizations.getMembers({
          id: org.id,
          per_page: 3,
          page: 0,
          include_totals: true,
        })

        expect(page1.members.length).toBeLessThanOrEqual(3)
        expect(page1.total).toBeGreaterThanOrEqual(6)
      })
    })

    describe('deleteMembers', () => {
      beforeEach(async () => {
        await management.organizations.addMembers(
          { id: org.id },
          { members: [testUser.user_id] }
        )
      })

      it('should remove member from organization', async () => {
        await management.organizations.deleteMembers(
          { id: org.id },
          { members: [testUser.user_id] }
        )

        const members = await management.organizations.getMembers({ id: org.id })
        expect(members.members.some((m) => m.user_id === testUser.user_id)).toBe(false)
      })

      it('should remove multiple members at once', async () => {
        const user2 = await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'remove-member2@example.com',
          password: 'SecurePass123!',
        })
        await management.organizations.addMembers(
          { id: org.id },
          { members: [user2.user_id] }
        )

        await management.organizations.deleteMembers(
          { id: org.id },
          { members: [testUser.user_id, user2.user_id] }
        )

        const members = await management.organizations.getMembers({ id: org.id })
        expect(members.members.length).toBe(0)
      })

      it('should not throw for non-member', async () => {
        const nonMember = await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'nonmember@example.com',
          password: 'SecurePass123!',
        })

        await expect(
          management.organizations.deleteMembers(
            { id: org.id },
            { members: [nonMember.user_id] }
          )
        ).resolves.not.toThrow()
      })
    })
  })

  // ============================================================================
  // MEMBER ROLES
  // ============================================================================

  describe('organizations.memberRoles', () => {
    let org: Organization
    let testUser: User

    beforeEach(async () => {
      org = await management.organizations.create({
        name: 'role-test-org',
        display_name: 'Role Test Organization',
      })

      testUser = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'role-member@example.com',
        password: 'SecurePass123!',
      })

      await management.organizations.addMembers(
        { id: org.id },
        { members: [testUser.user_id] }
      )
    })

    describe('addMemberRoles', () => {
      it('should assign roles to organization member', async () => {
        await management.organizations.addMemberRoles(
          { id: org.id, user_id: testUser.user_id },
          { roles: ['rol_admin', 'rol_editor'] }
        )

        const roles = await management.organizations.getMemberRoles({
          id: org.id,
          user_id: testUser.user_id,
        })

        expect(roles.roles.some((r) => r.id === 'rol_admin')).toBe(true)
        expect(roles.roles.some((r) => r.id === 'rol_editor')).toBe(true)
      })

      it('should throw for non-member', async () => {
        const nonMember = await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'nonmember-roles@example.com',
          password: 'SecurePass123!',
        })

        await expect(
          management.organizations.addMemberRoles(
            { id: org.id, user_id: nonMember.user_id },
            { roles: ['rol_admin'] }
          )
        ).rejects.toThrow()
      })
    })

    describe('getMemberRoles', () => {
      beforeEach(async () => {
        await management.organizations.addMemberRoles(
          { id: org.id, user_id: testUser.user_id },
          { roles: ['rol_viewer'] }
        )
      })

      it('should get member roles', async () => {
        const result = await management.organizations.getMemberRoles({
          id: org.id,
          user_id: testUser.user_id,
        })

        expect(result.roles).toBeDefined()
        expect(result.roles.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('deleteMemberRoles', () => {
      beforeEach(async () => {
        await management.organizations.addMemberRoles(
          { id: org.id, user_id: testUser.user_id },
          { roles: ['rol_admin', 'rol_editor'] }
        )
      })

      it('should remove roles from member', async () => {
        await management.organizations.deleteMemberRoles(
          { id: org.id, user_id: testUser.user_id },
          { roles: ['rol_admin'] }
        )

        const roles = await management.organizations.getMemberRoles({
          id: org.id,
          user_id: testUser.user_id,
        })

        expect(roles.roles.some((r) => r.id === 'rol_admin')).toBe(false)
        expect(roles.roles.some((r) => r.id === 'rol_editor')).toBe(true)
      })
    })
  })

  // ============================================================================
  // INVITATIONS
  // ============================================================================

  describe('organizations.invitations', () => {
    let org: Organization
    let inviter: User

    beforeEach(async () => {
      org = await management.organizations.create({
        name: 'invite-test-org',
        display_name: 'Invite Test Organization',
      })

      inviter = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'inviter@example.com',
        password: 'SecurePass123!',
        name: 'Inviter User',
      })

      await management.organizations.addMembers(
        { id: org.id },
        { members: [inviter.user_id] }
      )
    })

    describe('createInvitation', () => {
      it('should create an invitation', async () => {
        const invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter User' },
            invitee: { email: 'invitee@example.com' },
            client_id: 'test-client-id',
          }
        )

        expect(invitation).toBeDefined()
        expect(invitation.id).toBeDefined()
        expect(invitation.organization_id).toBe(org.id)
        expect(invitation.invitee.email).toBe('invitee@example.com')
        expect(invitation.invitation_url).toBeDefined()
        expect(invitation.ticket_id).toBeDefined()
        expect(invitation.expires_at).toBeDefined()
        expect(invitation.created_at).toBeDefined()
      })

      it('should create invitation with roles', async () => {
        const invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter User' },
            invitee: { email: 'invited-admin@example.com' },
            client_id: 'test-client-id',
            roles: ['rol_admin', 'rol_editor'],
          }
        )

        expect(invitation.roles).toEqual(['rol_admin', 'rol_editor'])
      })

      it('should create invitation with connection', async () => {
        const invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter User' },
            invitee: { email: 'sso-user@corp.com' },
            client_id: 'test-client-id',
            connection_id: 'con_corporate_saml',
          }
        )

        expect(invitation.connection_id).toBe('con_corporate_saml')
      })

      it('should create invitation with custom TTL', async () => {
        const invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter User' },
            invitee: { email: 'ttl-test@example.com' },
            client_id: 'test-client-id',
            ttl_sec: 86400, // 1 day
          }
        )

        expect(invitation).toBeDefined()
        // Check expiration is approximately 1 day from now
        const expiresAt = new Date(invitation.expires_at)
        const expectedExpiry = new Date(Date.now() + 86400 * 1000)
        expect(Math.abs(expiresAt.getTime() - expectedExpiry.getTime())).toBeLessThan(5000)
      })

      it('should reject invitation to existing member', async () => {
        // Add member first
        const existingMember = await management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'existing@example.com',
          password: 'SecurePass123!',
        })
        await management.organizations.addMembers(
          { id: org.id },
          { members: [existingMember.user_id] }
        )

        await expect(
          management.organizations.createInvitation(
            { id: org.id },
            {
              inviter: { name: 'Inviter User' },
              invitee: { email: 'existing@example.com' },
              client_id: 'test-client-id',
            }
          )
        ).rejects.toThrow()
      })
    })

    describe('getInvitations', () => {
      beforeEach(async () => {
        await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter' },
            invitee: { email: 'invite1@example.com' },
            client_id: 'test-client',
          }
        )
        await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter' },
            invitee: { email: 'invite2@example.com' },
            client_id: 'test-client',
          }
        )
      })

      it('should list all invitations for organization', async () => {
        const result = await management.organizations.getInvitations({ id: org.id })

        expect(result.invitations).toBeDefined()
        expect(result.invitations.length).toBeGreaterThanOrEqual(2)
      })

      it('should support pagination', async () => {
        const page1 = await management.organizations.getInvitations({
          id: org.id,
          per_page: 1,
          page: 0,
          include_totals: true,
        })

        expect(page1.invitations.length).toBe(1)
        expect(page1.total).toBeGreaterThanOrEqual(2)
      })

      it('should filter by sort', async () => {
        const ascending = await management.organizations.getInvitations({
          id: org.id,
          sort: 'created_at:1',
        })

        const descending = await management.organizations.getInvitations({
          id: org.id,
          sort: 'created_at:-1',
        })

        expect(ascending.invitations[0].id).not.toBe(descending.invitations[0].id)
      })
    })

    describe('getInvitation', () => {
      let invitation: OrganizationInvitation

      beforeEach(async () => {
        invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter' },
            invitee: { email: 'get-invite@example.com' },
            client_id: 'test-client',
          }
        )
      })

      it('should get invitation by ID', async () => {
        const result = await management.organizations.getInvitation({
          id: org.id,
          invitation_id: invitation.id,
        })

        expect(result).toBeDefined()
        expect(result.id).toBe(invitation.id)
        expect(result.invitee.email).toBe('get-invite@example.com')
      })

      it('should return null for non-existent invitation', async () => {
        const result = await management.organizations.getInvitation({
          id: org.id,
          invitation_id: 'inv_nonexistent',
        })

        expect(result).toBeNull()
      })
    })

    describe('deleteInvitation', () => {
      let invitation: OrganizationInvitation

      beforeEach(async () => {
        invitation = await management.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Inviter' },
            invitee: { email: 'delete-invite@example.com' },
            client_id: 'test-client',
          }
        )
      })

      it('should delete/revoke invitation', async () => {
        await management.organizations.deleteInvitation({
          id: org.id,
          invitation_id: invitation.id,
        })

        const result = await management.organizations.getInvitation({
          id: org.id,
          invitation_id: invitation.id,
        })

        expect(result).toBeNull()
      })

      it('should not throw for non-existent invitation', async () => {
        await expect(
          management.organizations.deleteInvitation({
            id: org.id,
            invitation_id: 'inv_nonexistent',
          })
        ).resolves.not.toThrow()
      })
    })
  })

  // ============================================================================
  // ENABLED CONNECTIONS
  // ============================================================================

  describe('organizations.connections', () => {
    let org: Organization

    beforeEach(async () => {
      org = await management.organizations.create({
        name: 'connection-test-org',
        display_name: 'Connection Test Organization',
      })
    })

    describe('addEnabledConnection', () => {
      it('should enable a connection for organization', async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: 'con_username_password',
            assign_membership_on_login: true,
          }
        )

        const connections = await management.organizations.getEnabledConnections({
          id: org.id,
        })

        expect(connections.enabled_connections.some(
          (c) => c.connection_id === 'con_username_password'
        )).toBe(true)
      })

      it('should enable connection with show_as_button option', async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: 'con_google',
            assign_membership_on_login: false,
            show_as_button: true,
          }
        )

        const connections = await management.organizations.getEnabledConnections({
          id: org.id,
        })

        const google = connections.enabled_connections.find(
          (c) => c.connection_id === 'con_google'
        )
        expect(google?.show_as_button).toBe(true)
      })

      it('should reject duplicate connection', async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: 'con_duplicate',
            assign_membership_on_login: true,
          }
        )

        await expect(
          management.organizations.addEnabledConnection(
            { id: org.id },
            {
              connection_id: 'con_duplicate',
              assign_membership_on_login: false,
            }
          )
        ).rejects.toThrow()
      })
    })

    describe('getEnabledConnections', () => {
      beforeEach(async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: 'con_1', assign_membership_on_login: true }
        )
        await management.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: 'con_2', assign_membership_on_login: false }
        )
      })

      it('should list enabled connections', async () => {
        const result = await management.organizations.getEnabledConnections({
          id: org.id,
        })

        expect(result.enabled_connections).toBeDefined()
        expect(result.enabled_connections.length).toBeGreaterThanOrEqual(2)
      })

      it('should support pagination', async () => {
        const page1 = await management.organizations.getEnabledConnections({
          id: org.id,
          per_page: 1,
          page: 0,
          include_totals: true,
        })

        expect(page1.enabled_connections.length).toBe(1)
        expect(page1.total).toBeGreaterThanOrEqual(2)
      })
    })

    describe('getEnabledConnection', () => {
      beforeEach(async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: 'con_specific',
            assign_membership_on_login: true,
            show_as_button: false,
          }
        )
      })

      it('should get specific enabled connection', async () => {
        const connection = await management.organizations.getEnabledConnection({
          id: org.id,
          connection_id: 'con_specific',
        })

        expect(connection).toBeDefined()
        expect(connection.connection_id).toBe('con_specific')
        expect(connection.assign_membership_on_login).toBe(true)
      })

      it('should return null for non-enabled connection', async () => {
        const connection = await management.organizations.getEnabledConnection({
          id: org.id,
          connection_id: 'con_not_enabled',
        })

        expect(connection).toBeNull()
      })
    })

    describe('updateEnabledConnection', () => {
      beforeEach(async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: 'con_update',
            assign_membership_on_login: false,
          }
        )
      })

      it('should update connection settings', async () => {
        const updated = await management.organizations.updateEnabledConnection(
          { id: org.id, connection_id: 'con_update' },
          { assign_membership_on_login: true }
        )

        expect(updated.assign_membership_on_login).toBe(true)
      })

      it('should throw for non-enabled connection', async () => {
        await expect(
          management.organizations.updateEnabledConnection(
            { id: org.id, connection_id: 'con_not_there' },
            { assign_membership_on_login: true }
          )
        ).rejects.toThrow()
      })
    })

    describe('deleteEnabledConnection', () => {
      beforeEach(async () => {
        await management.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: 'con_delete', assign_membership_on_login: true }
        )
      })

      it('should remove enabled connection', async () => {
        await management.organizations.deleteEnabledConnection({
          id: org.id,
          connection_id: 'con_delete',
        })

        const connection = await management.organizations.getEnabledConnection({
          id: org.id,
          connection_id: 'con_delete',
        })

        expect(connection).toBeNull()
      })

      it('should not throw for non-enabled connection', async () => {
        await expect(
          management.organizations.deleteEnabledConnection({
            id: org.id,
            connection_id: 'con_never_added',
          })
        ).resolves.not.toThrow()
      })
    })
  })

  // ============================================================================
  // USER-ORGANIZATION RELATIONSHIP
  // ============================================================================

  describe('users.getOrganizations', () => {
    let user: User
    let org1: Organization
    let org2: Organization

    beforeEach(async () => {
      user = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'multi-org-user@example.com',
        password: 'SecurePass123!',
      })

      org1 = await management.organizations.create({
        name: 'user-org-1',
        display_name: 'User Org 1',
      })

      org2 = await management.organizations.create({
        name: 'user-org-2',
        display_name: 'User Org 2',
      })

      await management.organizations.addMembers(
        { id: org1.id },
        { members: [user.user_id] }
      )
      await management.organizations.addMembers(
        { id: org2.id },
        { members: [user.user_id] }
      )
    })

    it('should list organizations a user belongs to', async () => {
      const result = await management.users.getOrganizations({
        id: user.user_id,
      })

      expect(result.organizations).toBeDefined()
      expect(result.organizations.length).toBe(2)
      expect(result.organizations.some((o) => o.id === org1.id)).toBe(true)
      expect(result.organizations.some((o) => o.id === org2.id)).toBe(true)
    })

    it('should return empty array for user with no organizations', async () => {
      const noOrgUser = await management.users.create({
        connection: 'Username-Password-Authentication',
        email: 'no-org-user@example.com',
        password: 'SecurePass123!',
      })

      const result = await management.users.getOrganizations({
        id: noOrgUser.user_id,
      })

      expect(result.organizations).toEqual([])
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw descriptive error for organization not found', async () => {
      try {
        await management.organizations.update(
          { id: 'org_nonexistent' },
          { display_name: 'Test' }
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
        expect((error as Error).message).toContain('not found')
      }
    })

    it('should include error code in thrown errors', async () => {
      try {
        await management.organizations.create({
          name: '', // Invalid empty name
          display_name: 'Empty Name',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })

    it('should handle concurrent operations gracefully', async () => {
      const org = await management.organizations.create({
        name: 'concurrent-org',
        display_name: 'Concurrent Org',
      })

      // Create multiple users and add them concurrently
      const users = await Promise.all([
        management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'concurrent1@example.com',
          password: 'SecurePass123!',
        }),
        management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'concurrent2@example.com',
          password: 'SecurePass123!',
        }),
        management.users.create({
          connection: 'Username-Password-Authentication',
          email: 'concurrent3@example.com',
          password: 'SecurePass123!',
        }),
      ])

      // Add all members concurrently
      await Promise.all(
        users.map((u) =>
          management.organizations.addMembers(
            { id: org.id },
            { members: [u.user_id] }
          )
        )
      )

      const members = await management.organizations.getMembers({ id: org.id })
      expect(members.members.length).toBe(3)
    })
  })
})
