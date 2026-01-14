/**
 * Auth0 Organizations API Tests (RED Phase TDD)
 *
 * Comprehensive tests for Auth0 Organizations multi-tenancy support.
 * These tests are expected to FAIL because the implementation doesn't exist yet.
 *
 * Auth0 Organizations enable:
 * - B2B SaaS multi-tenancy
 * - Enterprise customer isolation
 * - Per-organization connections and branding
 * - Member and invitation management
 *
 * @see https://auth0.com/docs/manage-users/organizations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ManagementClient, createManagementClient, Auth0APIError } from '../index'

// ============================================================================
// ORGANIZATION TYPES (Expected interface for Organizations API)
// ============================================================================

interface Auth0Organization {
  id: string
  name: string
  display_name: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
  enabled_connections?: OrganizationConnection[]
}

interface OrganizationBranding {
  logo_url?: string
  colors?: {
    primary?: string
    page_background?: string
  }
}

interface OrganizationConnection {
  connection_id: string
  assign_membership_on_login?: boolean
  show_as_button?: boolean
}

interface OrganizationMember {
  user_id: string
  email?: string
  name?: string
  picture?: string
  roles?: string[]
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
  invitation_url?: string
  ticket_id?: string
  created_at: string
  expires_at: string
  roles?: string[]
  connection_id?: string
}

interface CreateOrganizationParams {
  name: string
  display_name: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
  enabled_connections?: Array<{
    connection_id: string
    assign_membership_on_login?: boolean
    show_as_button?: boolean
  }>
}

interface UpdateOrganizationParams {
  display_name?: string
  name?: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
}

interface CreateInvitationParams {
  inviter: {
    name: string
  }
  invitee: {
    email: string
  }
  client_id: string
  connection_id?: string
  roles?: string[]
  ttl_sec?: number
  send_invitation_email?: boolean
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Auth0 Organizations API', () => {
  let client: ManagementClient

  beforeEach(() => {
    client = createManagementClient({
      domain: 'test.auth0.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      audience: 'https://test.auth0.com/api/v2/',
    })
  })

  // ============================================================================
  // ORGANIZATION CRUD
  // ============================================================================

  describe('organizations.create', () => {
    it('should create an organization', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.create({
        name: 'acme-corp',
        display_name: 'Acme Corporation',
      })

      expect(org).toBeDefined()
      expect(org.id).toBeDefined()
      expect(org.name).toBe('acme-corp')
      expect(org.display_name).toBe('Acme Corporation')
    })

    it('should create an organization with branding', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.create({
        name: 'branded-org',
        display_name: 'Branded Organization',
        branding: {
          logo_url: 'https://example.com/logo.png',
          colors: {
            primary: '#FF5733',
            page_background: '#F5F5F5',
          },
        },
      })

      expect(org.branding).toBeDefined()
      expect(org.branding?.logo_url).toBe('https://example.com/logo.png')
      expect(org.branding?.colors?.primary).toBe('#FF5733')
    })

    it('should create an organization with metadata', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.create({
        name: 'meta-org',
        display_name: 'Organization with Metadata',
        metadata: {
          plan: 'enterprise',
          region: 'us-west-2',
          customField: 'value',
        },
      })

      expect(org.metadata).toEqual({
        plan: 'enterprise',
        region: 'us-west-2',
        customField: 'value',
      })
    })

    it('should create an organization with enabled connections', async () => {
      // First create a connection
      const connection = await client.connections.create({
        name: 'org-connection',
        strategy: 'auth0',
      })

      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.create({
        name: 'connected-org',
        display_name: 'Connected Organization',
        enabled_connections: [
          {
            connection_id: connection.id,
            assign_membership_on_login: true,
            show_as_button: true,
          },
        ],
      })

      expect(org.enabled_connections).toHaveLength(1)
      expect(org.enabled_connections?.[0].connection_id).toBe(connection.id)
    })

    it('should reject duplicate organization names', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.create({
        name: 'unique-org',
        display_name: 'First Org',
      })

      // @ts-expect-error - organizations API not implemented yet
      await expect(
        client.organizations.create({
          name: 'unique-org',
          display_name: 'Second Org',
        })
      ).rejects.toThrow(Auth0APIError)
    })

    it('should validate organization name format', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await expect(
        client.organizations.create({
          name: 'Invalid Name With Spaces',
          display_name: 'Test',
        })
      ).rejects.toThrow(Auth0APIError)
    })
  })

  describe('organizations.get', () => {
    it('should get an organization by ID', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'get-org',
        display_name: 'Get Organization',
      })

      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.get({ id: created.id })

      expect(org.id).toBe(created.id)
      expect(org.name).toBe('get-org')
    })

    it('should throw 404 for non-existent organization', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await expect(
        client.organizations.get({ id: 'org_nonexistent' })
      ).rejects.toThrow(Auth0APIError)
    })
  })

  describe('organizations.getByName', () => {
    it('should get an organization by name', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.create({
        name: 'findable-org',
        display_name: 'Findable Organization',
      })

      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.getByName('findable-org')

      expect(org).toBeDefined()
      expect(org.name).toBe('findable-org')
    })

    it('should return null for non-existent organization name', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const org = await client.organizations.getByName('nonexistent-org')

      expect(org).toBeNull()
    })
  })

  describe('organizations.update', () => {
    it('should update organization display name', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'update-org',
        display_name: 'Original Name',
      })

      // @ts-expect-error - organizations API not implemented yet
      const updated = await client.organizations.update(
        { id: created.id },
        { display_name: 'Updated Name' }
      )

      expect(updated.display_name).toBe('Updated Name')
    })

    it('should update organization branding', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'brand-update-org',
        display_name: 'Brand Update Org',
      })

      // @ts-expect-error - organizations API not implemented yet
      const updated = await client.organizations.update(
        { id: created.id },
        {
          branding: {
            logo_url: 'https://new-logo.com/logo.png',
            colors: { primary: '#00FF00' },
          },
        }
      )

      expect(updated.branding?.logo_url).toBe('https://new-logo.com/logo.png')
      expect(updated.branding?.colors?.primary).toBe('#00FF00')
    })

    it('should update organization metadata', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'meta-update-org',
        display_name: 'Meta Update Org',
        metadata: { original: 'value' },
      })

      // @ts-expect-error - organizations API not implemented yet
      const updated = await client.organizations.update(
        { id: created.id },
        { metadata: { updated: 'new-value', added: 'field' } }
      )

      expect(updated.metadata).toEqual({ updated: 'new-value', added: 'field' })
    })

    it('should rename organization', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'old-name',
        display_name: 'Rename Org',
      })

      // @ts-expect-error - organizations API not implemented yet
      const updated = await client.organizations.update(
        { id: created.id },
        { name: 'new-name' }
      )

      expect(updated.name).toBe('new-name')
    })
  })

  describe('organizations.delete', () => {
    it('should delete an organization', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const created = await client.organizations.create({
        name: 'delete-org',
        display_name: 'Delete Organization',
      })

      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.delete({ id: created.id })

      // @ts-expect-error - organizations API not implemented yet
      await expect(
        client.organizations.get({ id: created.id })
      ).rejects.toThrow(Auth0APIError)
    })

    it('should throw error when deleting non-existent organization', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await expect(
        client.organizations.delete({ id: 'org_nonexistent' })
      ).rejects.toThrow(Auth0APIError)
    })
  })

  describe('organizations.getAll', () => {
    it('should list all organizations', async () => {
      // Create multiple organizations
      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.create({
        name: 'list-org-1',
        display_name: 'List Org 1',
      })
      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.create({
        name: 'list-org-2',
        display_name: 'List Org 2',
      })

      // @ts-expect-error - organizations API not implemented yet
      const orgs = await client.organizations.getAll()

      expect(Array.isArray(orgs)).toBe(true)
      expect(orgs.length).toBeGreaterThanOrEqual(2)
    })

    it('should support pagination', async () => {
      // @ts-expect-error - organizations API not implemented yet
      const result = await client.organizations.getAll({
        page: 0,
        per_page: 10,
        include_totals: true,
      })

      expect(result).toHaveProperty('start')
      expect(result).toHaveProperty('limit')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('organizations')
    })

    it('should filter by name', async () => {
      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.create({
        name: 'search-target',
        display_name: 'Search Target',
      })

      // @ts-expect-error - organizations API not implemented yet
      const orgs = await client.organizations.getAll({
        q: 'name:search-target',
      })

      expect(orgs.length).toBe(1)
      expect(orgs[0].name).toBe('search-target')
    })
  })

  // ============================================================================
  // ORGANIZATION MEMBERS
  // ============================================================================

  describe('organizations.members', () => {
    let org: Auth0Organization
    let user: { user_id: string }

    beforeEach(async () => {
      // Create test organization
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `member-test-${Date.now()}`,
        display_name: 'Member Test Org',
      })

      // Create test user
      user = await client.users.create({
        email: `member-${Date.now()}@example.com`,
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })
    })

    describe('addMembers', () => {
      it('should add a member to an organization', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members).toHaveLength(1)
        expect(members[0].user_id).toBe(user.user_id)
      })

      it('should add multiple members at once', async () => {
        const user2 = await client.users.create({
          email: `member2-${Date.now()}@example.com`,
          password: 'Test123!@#',
          connection: 'Username-Password-Authentication',
        })

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id, user2.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members).toHaveLength(2)
      })

      it('should not duplicate members', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members).toHaveLength(1)
      })
    })

    describe('getMembers', () => {
      it('should return empty array for organization with no members', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members).toEqual([])
      })

      it('should return member details', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members[0]).toHaveProperty('user_id')
        expect(members[0]).toHaveProperty('email')
      })

      it('should support pagination', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const result = await client.organizations.getMembers({
          id: org.id,
          page: 0,
          per_page: 10,
          include_totals: true,
        })

        expect(result).toHaveProperty('members')
        expect(result).toHaveProperty('total')
      })
    })

    describe('removeMembers', () => {
      it('should remove a member from an organization', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.removeMembers(
          { id: org.id },
          { members: [user.user_id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const members = await client.organizations.getMembers({ id: org.id })

        expect(members).toHaveLength(0)
      })

      it('should not throw when removing non-member', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await expect(
          client.organizations.removeMembers(
            { id: org.id },
            { members: ['auth0|nonexistent'] }
          )
        ).resolves.not.toThrow()
      })
    })
  })

  // ============================================================================
  // ORGANIZATION MEMBER ROLES
  // ============================================================================

  describe('organizations.memberRoles', () => {
    let org: Auth0Organization
    let user: { user_id: string }
    let role: { id: string }

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `role-test-${Date.now()}`,
        display_name: 'Role Test Org',
      })

      user = await client.users.create({
        email: `role-user-${Date.now()}@example.com`,
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      role = await client.roles.create({
        name: `org-role-${Date.now()}`,
        description: 'Test role for organization',
      })

      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.addMembers(
        { id: org.id },
        { members: [user.user_id] }
      )
    })

    describe('addMemberRoles', () => {
      it('should assign roles to an organization member', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMemberRoles(
          { id: org.id, user_id: user.user_id },
          { roles: [role.id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const memberRoles = await client.organizations.getMemberRoles({
          id: org.id,
          user_id: user.user_id,
        })

        expect(memberRoles).toHaveLength(1)
        expect(memberRoles[0].id).toBe(role.id)
      })
    })

    describe('getMemberRoles', () => {
      it('should return roles for a member', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMemberRoles(
          { id: org.id, user_id: user.user_id },
          { roles: [role.id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const memberRoles = await client.organizations.getMemberRoles({
          id: org.id,
          user_id: user.user_id,
        })

        expect(memberRoles).toBeDefined()
        expect(Array.isArray(memberRoles)).toBe(true)
      })

      it('should return empty array when member has no roles', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const memberRoles = await client.organizations.getMemberRoles({
          id: org.id,
          user_id: user.user_id,
        })

        expect(memberRoles).toEqual([])
      })
    })

    describe('removeMemberRoles', () => {
      it('should remove roles from an organization member', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addMemberRoles(
          { id: org.id, user_id: user.user_id },
          { roles: [role.id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.removeMemberRoles(
          { id: org.id, user_id: user.user_id },
          { roles: [role.id] }
        )

        // @ts-expect-error - organizations API not implemented yet
        const memberRoles = await client.organizations.getMemberRoles({
          id: org.id,
          user_id: user.user_id,
        })

        expect(memberRoles).toHaveLength(0)
      })
    })
  })

  // ============================================================================
  // ORGANIZATION INVITATIONS
  // ============================================================================

  describe('organizations.invitations', () => {
    let org: Auth0Organization
    let authClient: { client_id: string }

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `invite-test-${Date.now()}`,
        display_name: 'Invitation Test Org',
      })

      authClient = await client.clients.create({
        name: 'Invite Client',
        app_type: 'spa',
      })
    })

    describe('createInvitation', () => {
      it('should create an organization invitation', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'invitee@example.com' },
            client_id: authClient.client_id,
          }
        )

        expect(invitation).toBeDefined()
        expect(invitation.id).toBeDefined()
        expect(invitation.organization_id).toBe(org.id)
        expect(invitation.invitee.email).toBe('invitee@example.com')
      })

      it('should create invitation with roles', async () => {
        const role = await client.roles.create({
          name: `invite-role-${Date.now()}`,
          description: 'Role for invitees',
        })

        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'invitee-role@example.com' },
            client_id: authClient.client_id,
            roles: [role.id],
          }
        )

        expect(invitation.roles).toContain(role.id)
      })

      it('should create invitation with custom TTL', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'ttl-invitee@example.com' },
            client_id: authClient.client_id,
            ttl_sec: 86400, // 24 hours
          }
        )

        expect(invitation.expires_at).toBeDefined()
        const expiresAt = new Date(invitation.expires_at).getTime()
        const createdAt = new Date(invitation.created_at).getTime()
        expect(expiresAt - createdAt).toBeCloseTo(86400 * 1000, -3)
      })

      it('should create invitation with specific connection', async () => {
        const connection = await client.connections.create({
          name: `invite-conn-${Date.now()}`,
          strategy: 'auth0',
        })

        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'conn-invitee@example.com' },
            client_id: authClient.client_id,
            connection_id: connection.id,
          }
        )

        expect(invitation.connection_id).toBe(connection.id)
      })

      it('should generate invitation URL', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'url-invitee@example.com' },
            client_id: authClient.client_id,
            send_invitation_email: false,
          }
        )

        expect(invitation.invitation_url).toBeDefined()
        expect(invitation.ticket_id).toBeDefined()
      })
    })

    describe('getInvitations', () => {
      it('should list organization invitations', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'list-invitee@example.com' },
            client_id: authClient.client_id,
          }
        )

        // @ts-expect-error - organizations API not implemented yet
        const invitations = await client.organizations.getInvitations({ id: org.id })

        expect(Array.isArray(invitations)).toBe(true)
        expect(invitations.length).toBeGreaterThanOrEqual(1)
      })

      it('should return empty array when no invitations', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const invitations = await client.organizations.getInvitations({ id: org.id })

        expect(invitations).toEqual([])
      })

      it('should support pagination', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const result = await client.organizations.getInvitations({
          id: org.id,
          page: 0,
          per_page: 10,
          include_totals: true,
        })

        expect(result).toHaveProperty('invitations')
        expect(result).toHaveProperty('total')
      })
    })

    describe('getInvitation', () => {
      it('should get a specific invitation', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const created = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'get-invitee@example.com' },
            client_id: authClient.client_id,
          }
        )

        // @ts-expect-error - organizations API not implemented yet
        const invitation = await client.organizations.getInvitation({
          id: org.id,
          invitation_id: created.id,
        })

        expect(invitation.id).toBe(created.id)
        expect(invitation.invitee.email).toBe('get-invitee@example.com')
      })

      it('should throw 404 for non-existent invitation', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await expect(
          client.organizations.getInvitation({
            id: org.id,
            invitation_id: 'uinv_nonexistent',
          })
        ).rejects.toThrow(Auth0APIError)
      })
    })

    describe('deleteInvitation', () => {
      it('should delete an invitation', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const created = await client.organizations.createInvitation(
          { id: org.id },
          {
            inviter: { name: 'Admin User' },
            invitee: { email: 'delete-invitee@example.com' },
            client_id: authClient.client_id,
          }
        )

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.deleteInvitation({
          id: org.id,
          invitation_id: created.id,
        })

        // @ts-expect-error - organizations API not implemented yet
        await expect(
          client.organizations.getInvitation({
            id: org.id,
            invitation_id: created.id,
          })
        ).rejects.toThrow(Auth0APIError)
      })
    })
  })

  // ============================================================================
  // ORGANIZATION CONNECTIONS
  // ============================================================================

  describe('organizations.connections', () => {
    let org: Auth0Organization
    let connection: { id: string }

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `conn-test-${Date.now()}`,
        display_name: 'Connection Test Org',
      })

      connection = await client.connections.create({
        name: `test-conn-${Date.now()}`,
        strategy: 'auth0',
      })
    })

    describe('addEnabledConnection', () => {
      it('should enable a connection for an organization', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const enabledConnection = await client.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: connection.id,
            assign_membership_on_login: false,
            show_as_button: true,
          }
        )

        expect(enabledConnection.connection_id).toBe(connection.id)
      })

      it('should enable connection with auto-membership', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const enabledConnection = await client.organizations.addEnabledConnection(
          { id: org.id },
          {
            connection_id: connection.id,
            assign_membership_on_login: true,
          }
        )

        expect(enabledConnection.assign_membership_on_login).toBe(true)
      })
    })

    describe('getEnabledConnections', () => {
      it('should list enabled connections', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: connection.id }
        )

        // @ts-expect-error - organizations API not implemented yet
        const connections = await client.organizations.getEnabledConnections({ id: org.id })

        expect(Array.isArray(connections)).toBe(true)
        expect(connections.length).toBeGreaterThanOrEqual(1)
      })

      it('should return empty array when no connections enabled', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const connections = await client.organizations.getEnabledConnections({ id: org.id })

        expect(connections).toEqual([])
      })

      it('should support pagination', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const result = await client.organizations.getEnabledConnections({
          id: org.id,
          page: 0,
          per_page: 10,
          include_totals: true,
        })

        expect(result).toHaveProperty('enabled_connections')
        expect(result).toHaveProperty('total')
      })
    })

    describe('getEnabledConnection', () => {
      it('should get a specific enabled connection', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: connection.id, show_as_button: true }
        )

        // @ts-expect-error - organizations API not implemented yet
        const enabledConnection = await client.organizations.getEnabledConnection({
          id: org.id,
          connection_id: connection.id,
        })

        expect(enabledConnection.connection_id).toBe(connection.id)
        expect(enabledConnection.show_as_button).toBe(true)
      })

      it('should throw 404 for non-enabled connection', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await expect(
          client.organizations.getEnabledConnection({
            id: org.id,
            connection_id: connection.id,
          })
        ).rejects.toThrow(Auth0APIError)
      })
    })

    describe('updateEnabledConnection', () => {
      it('should update enabled connection settings', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: connection.id, assign_membership_on_login: false }
        )

        // @ts-expect-error - organizations API not implemented yet
        const updated = await client.organizations.updateEnabledConnection(
          { id: org.id, connection_id: connection.id },
          { assign_membership_on_login: true, show_as_button: false }
        )

        expect(updated.assign_membership_on_login).toBe(true)
        expect(updated.show_as_button).toBe(false)
      })
    })

    describe('removeEnabledConnection', () => {
      it('should disable a connection for an organization', async () => {
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.addEnabledConnection(
          { id: org.id },
          { connection_id: connection.id }
        )

        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.removeEnabledConnection({
          id: org.id,
          connection_id: connection.id,
        })

        // @ts-expect-error - organizations API not implemented yet
        const connections = await client.organizations.getEnabledConnections({ id: org.id })

        expect(connections).toHaveLength(0)
      })
    })
  })

  // ============================================================================
  // ORGANIZATION BRANDING
  // ============================================================================

  describe('organizations.branding', () => {
    let org: Auth0Organization

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `brand-test-${Date.now()}`,
        display_name: 'Branding Test Org',
      })
    })

    describe('getBranding', () => {
      it('should get organization branding', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const branding = await client.organizations.getBranding({ id: org.id })

        expect(branding).toBeDefined()
      })

      it('should return default branding when not set', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const branding = await client.organizations.getBranding({ id: org.id })

        expect(branding).toEqual({})
      })
    })

    describe('updateBranding', () => {
      it('should update organization branding', async () => {
        // @ts-expect-error - organizations API not implemented yet
        const updated = await client.organizations.updateBranding(
          { id: org.id },
          {
            logo_url: 'https://example.com/new-logo.png',
            colors: {
              primary: '#123456',
              page_background: '#FFFFFF',
            },
          }
        )

        expect(updated.logo_url).toBe('https://example.com/new-logo.png')
        expect(updated.colors?.primary).toBe('#123456')
      })

      it('should partially update branding', async () => {
        // First set initial branding
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.updateBranding(
          { id: org.id },
          {
            logo_url: 'https://example.com/logo.png',
            colors: { primary: '#FF0000' },
          }
        )

        // Update only colors
        // @ts-expect-error - organizations API not implemented yet
        const updated = await client.organizations.updateBranding(
          { id: org.id },
          { colors: { primary: '#00FF00' } }
        )

        expect(updated.logo_url).toBe('https://example.com/logo.png')
        expect(updated.colors?.primary).toBe('#00FF00')
      })
    })

    describe('deleteBranding', () => {
      it('should delete organization branding', async () => {
        // First set branding
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.updateBranding(
          { id: org.id },
          { logo_url: 'https://example.com/logo.png' }
        )

        // Delete branding
        // @ts-expect-error - organizations API not implemented yet
        await client.organizations.deleteBranding({ id: org.id })

        // @ts-expect-error - organizations API not implemented yet
        const branding = await client.organizations.getBranding({ id: org.id })

        expect(branding).toEqual({})
      })
    })
  })

  // ============================================================================
  // USER ORGANIZATIONS
  // ============================================================================

  describe('users.organizations', () => {
    let org: Auth0Organization
    let user: { user_id: string }

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `user-org-test-${Date.now()}`,
        display_name: 'User Org Test',
      })

      user = await client.users.create({
        email: `user-org-${Date.now()}@example.com`,
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      // @ts-expect-error - organizations API not implemented yet
      await client.organizations.addMembers(
        { id: org.id },
        { members: [user.user_id] }
      )
    })

    it('should get organizations for a user', async () => {
      // @ts-expect-error - getOrganizations not implemented yet
      const userOrgs = await client.users.getOrganizations({ id: user.user_id })

      expect(Array.isArray(userOrgs)).toBe(true)
      expect(userOrgs.length).toBeGreaterThanOrEqual(1)
      expect(userOrgs.some((o: Auth0Organization) => o.id === org.id)).toBe(true)
    })

    it('should return empty array when user has no organizations', async () => {
      const newUser = await client.users.create({
        email: `no-org-${Date.now()}@example.com`,
        password: 'Test123!@#',
        connection: 'Username-Password-Authentication',
      })

      // @ts-expect-error - getOrganizations not implemented yet
      const userOrgs = await client.users.getOrganizations({ id: newUser.user_id })

      expect(userOrgs).toEqual([])
    })
  })

  // ============================================================================
  // AUTHENTICATION WITH ORGANIZATIONS
  // ============================================================================

  describe('organization authentication', () => {
    let org: Auth0Organization

    beforeEach(async () => {
      // @ts-expect-error - organizations API not implemented yet
      org = await client.organizations.create({
        name: `auth-test-${Date.now()}`,
        display_name: 'Auth Test Org',
      })
    })

    it('should validate organization parameter', async () => {
      // This tests that the organization name/id can be passed to auth flows
      // The actual authentication would be handled by the Authentication API
      expect(org.name).toBeDefined()
      expect(org.id).toBeDefined()
    })

    it('should support organization invitation ticket', async () => {
      const authClient = await client.clients.create({
        name: 'Auth Test Client',
        app_type: 'spa',
      })

      // @ts-expect-error - organizations API not implemented yet
      const invitation = await client.organizations.createInvitation(
        { id: org.id },
        {
          inviter: { name: 'Admin' },
          invitee: { email: 'auth-test@example.com' },
          client_id: authClient.client_id,
          send_invitation_email: false,
        }
      )

      expect(invitation.ticket_id).toBeDefined()
      expect(invitation.invitation_url).toContain('organization=')
    })
  })
})
