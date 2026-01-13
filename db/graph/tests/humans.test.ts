/**
 * Humans Graph Module Tests
 *
 * Comprehensive tests for Users, Organizations, Roles, Sessions as Graph Things
 * with better-auth integration.
 *
 * NO MOCKS - uses real SQLite via better-sqlite3
 *
 * @see dotdo-4nc8u - Humans (Users/Orgs/Roles) as Graph Things
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import type { GraphStore } from '../types'
import {
  // Types
  HUMAN_TYPE_IDS,
  HUMAN_TYPE_NAMES,
  HUMAN_VERBS,
  HumanUrls,
  type UserThingData,
  type OrgThingData,
  type OrgMembershipData,
  type ApprovalRequestThingData,
  type NotificationPriority,
  // User operations
  createUser,
  getUser,
  getUserByEmail,
  updateUser,
  deleteUser,
  assignUserRole,
  getUserRoles,
  addUserToOrg,
  getUserOrganizations,
  // Org operations
  createOrg,
  getOrg,
  getOrgBySlug,
  addMember,
  removeMember,
  getOrgMembers,
  isMember,
  getMemberRole,
  createInvitation,
  acceptInvitation,
  // Role operations
  createRole,
  assignRole,
  entityHasRole,
  checkRolePermission,
  // Approval operations
  createApprovalRequest,
  getApprovalRequest,
  getApprovalStatus,
  startReview,
  approve,
  reject,
  escalateApproval,
  getPendingApprovals,
  getApprovalHistory,
  // Convenience functions
  createUserWithOrg,
  createStandardRoles,
  createHumanRoleTemplates,
  HUMAN_ROLE_TEMPLATES,
} from '../humans'

// ============================================================================
// TEST SETUP
// ============================================================================

describe('Humans Graph Module', () => {
  let graph: GraphStore

  beforeEach(async () => {
    // Create in-memory SQLite GraphStore
    graph = new SQLiteGraphStore(':memory:')
    await graph.initialize()
  })

  afterEach(async () => {
    // SQLiteGraphStore handles its own cleanup
  })

  // ==========================================================================
  // USER AS THING TESTS
  // ==========================================================================

  describe('User as Thing', () => {
    it('creates a User Thing with email and name', async () => {
      const user = await createUser(graph, {
        email: 'alice@example.com',
        name: 'Alice',
        status: 'active',
      })

      expect(user).toBeDefined()
      expect(user.id).toMatch(/^user-/)
      expect(user.typeName).toBe('User')
      const data = user.data as UserThingData
      expect(data.email).toBe('alice@example.com')
      expect(data.name).toBe('Alice')
      expect(data.status).toBe('active')
    })

    it('enforces unique email constraint', async () => {
      await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })

      await expect(
        createUser(graph, { email: 'alice@example.com', name: 'Alice 2', status: 'active' })
      ).rejects.toThrow(/already exists/)
    })

    it('gets user by email (case-insensitive)', async () => {
      await createUser(graph, { email: 'Alice@Example.com', name: 'Alice', status: 'active' })

      const found = await getUserByEmail(graph, 'alice@example.com')
      expect(found).toBeDefined()
      expect((found!.data as UserThingData).name).toBe('Alice')
    })

    it('returns null for non-existent user', async () => {
      const found = await getUser(graph, 'non-existent')
      expect(found).toBeNull()
    })

    it('updates user data', async () => {
      const user = await createUser(graph, {
        email: 'alice@example.com',
        name: 'Alice',
        status: 'active',
      })

      const updated = await updateUser(graph, user.id, { name: 'Alice Smith' })
      expect(updated).toBeDefined()
      expect((updated!.data as UserThingData).name).toBe('Alice Smith')
    })

    it('soft-deletes user', async () => {
      const user = await createUser(graph, {
        email: 'alice@example.com',
        name: 'Alice',
        status: 'active',
      })

      await deleteUser(graph, user.id)

      const found = await getUser(graph, user.id)
      expect(found).toBeNull() // Soft-deleted users are filtered out
    })

    it('stores additional user fields', async () => {
      const user = await createUser(graph, {
        email: 'alice@example.com',
        name: 'Alice',
        displayName: 'Alice Smith',
        firstName: 'Alice',
        lastName: 'Smith',
        status: 'active',
        emailVerified: true,
        avatarUrl: 'https://example.com/avatar.png',
        bio: 'Software engineer',
        timezone: 'America/New_York',
        locale: 'en-US',
      })

      const data = user.data as UserThingData
      expect(data.displayName).toBe('Alice Smith')
      expect(data.firstName).toBe('Alice')
      expect(data.lastName).toBe('Smith')
      expect(data.emailVerified).toBe(true)
      expect(data.avatarUrl).toBe('https://example.com/avatar.png')
      expect(data.bio).toBe('Software engineer')
      expect(data.timezone).toBe('America/New_York')
      expect(data.locale).toBe('en-US')
    })
  })

  // ==========================================================================
  // ORGANIZATION AS THING TESTS
  // ==========================================================================

  describe('Organization as Thing', () => {
    it('creates an Org Thing with name and slug', async () => {
      const org = await createOrg(graph, {
        name: 'Acme Inc',
        slug: 'acme',
        status: 'active',
      })

      expect(org).toBeDefined()
      expect(org.id).toMatch(/^org-/)
      expect(org.typeName).toBe('Org')
      const data = org.data as OrgThingData
      expect(data.name).toBe('Acme Inc')
      expect(data.slug).toBe('acme')
      expect(data.status).toBe('active')
    })

    it('enforces unique slug constraint', async () => {
      await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      await expect(
        createOrg(graph, { name: 'Acme Corp', slug: 'acme', status: 'active' })
      ).rejects.toThrow(/already exists/)
    })

    it('normalizes slug to lowercase', async () => {
      const org = await createOrg(graph, { name: 'Test', slug: 'MyOrg', status: 'active' })
      const data = org.data as OrgThingData
      expect(data.slug).toBe('myorg')
    })

    it('gets org by slug', async () => {
      await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      const found = await getOrgBySlug(graph, 'acme')
      expect(found).toBeDefined()
      expect((found!.data as OrgThingData).name).toBe('Acme Inc')
    })

    it('stores org settings', async () => {
      const org = await createOrg(graph, {
        name: 'Acme Inc',
        slug: 'acme',
        status: 'active',
        logoUrl: 'https://example.com/logo.png',
        description: 'A test company',
        settings: {
          defaultRole: 'member',
          allowedDomains: ['acme.com'],
        },
      })

      const data = org.data as OrgThingData
      expect(data.logoUrl).toBe('https://example.com/logo.png')
      expect(data.description).toBe('A test company')
      expect(data.settings?.defaultRole).toBe('member')
      expect(data.settings?.allowedDomains).toContain('acme.com')
    })
  })

  // ==========================================================================
  // MEMBER_OF RELATIONSHIP TESTS
  // ==========================================================================

  describe('memberOf Relationship (User -> Org)', () => {
    it('adds user to org with memberOf relationship', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      await addMember(graph, user.id, org.id, { role: 'admin' })

      const isMemberResult = await isMember(graph, user.id, org.id)
      expect(isMemberResult).toBe(true)

      const role = await getMemberRole(graph, user.id, org.id)
      expect(role).toBe('admin')
    })

    it('gets org members via backward traversal', async () => {
      const user1 = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const user2 = await createUser(graph, { email: 'bob@example.com', name: 'Bob', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      await addMember(graph, user1.id, org.id, { role: 'admin' })
      await addMember(graph, user2.id, org.id, { role: 'member' })

      const members = await getOrgMembers(graph, org.id)
      expect(members).toHaveLength(2)
      expect(members.map(m => (m.user.data as UserThingData).email).sort()).toEqual([
        'alice@example.com',
        'bob@example.com',
      ])
    })

    it('gets user orgs via forward traversal', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const org1 = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })
      const org2 = await createOrg(graph, { name: 'Beta Corp', slug: 'beta', status: 'active' })

      await addMember(graph, user.id, org1.id, { role: 'admin' })
      await addMember(graph, user.id, org2.id, { role: 'member' })

      const orgs = await getUserOrganizations(graph, user.id)
      expect(orgs).toHaveLength(2)
    })

    it('removes user from org', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      await addMember(graph, user.id, org.id, { role: 'member' })
      expect(await isMember(graph, user.id, org.id)).toBe(true)

      await removeMember(graph, user.id, org.id)
      expect(await isMember(graph, user.id, org.id)).toBe(false)
    })

    it('stores membership metadata', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      await addMember(graph, user.id, org.id, {
        role: 'engineer',
        title: 'Senior Engineer',
        department: 'Engineering',
      })

      const members = await getOrgMembers(graph, org.id)
      expect(members[0]!.membership.title).toBe('Senior Engineer')
      expect(members[0]!.membership.department).toBe('Engineering')
    })
  })

  // ==========================================================================
  // INVITATION WORKFLOW TESTS
  // ==========================================================================

  describe('Invitation Workflow (verb form: invite -> inviting -> invited)', () => {
    it('creates invitation with pending status', async () => {
      const inviter = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })
      await addMember(graph, inviter.id, org.id, { role: 'admin' })

      const invitation = await createInvitation(graph, {
        email: 'bob@example.com',
        orgId: org.id,
        role: 'member',
        invitedBy: inviter.id,
        message: 'Join our team!',
      })

      expect(invitation).toBeDefined()
      expect(invitation.typeName).toBe('Invitation')
      const data = invitation.data as { email: string; status: string; token: string }
      expect(data.email).toBe('bob@example.com')
      expect(data.status).toBe('pending')
      expect(data.token).toBeDefined()
    })

    it('accepts invitation and adds user to org', async () => {
      const inviter = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const invitee = await createUser(graph, { email: 'bob@example.com', name: 'Bob', status: 'active' })
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })
      await addMember(graph, inviter.id, org.id, { role: 'admin' })

      const invitation = await createInvitation(graph, {
        email: 'bob@example.com',
        orgId: org.id,
        role: 'member',
        invitedBy: inviter.id,
      })

      const { org: joinedOrg, membership } = await acceptInvitation(graph, invitation.id, invitee.id)

      expect(joinedOrg.id).toBe(org.id)
      expect(membership.role).toBe('member')
      expect(await isMember(graph, invitee.id, org.id)).toBe(true)
    })
  })

  // ==========================================================================
  // ROLE AS THING TESTS
  // ==========================================================================

  describe('Role as Thing', () => {
    it('creates a Role Thing with permissions', async () => {
      const role = await createRole(graph, {
        name: 'admin',
        permissions: ['read:*', 'write:*', 'admin:settings'],
        description: 'Administrator role',
        hierarchyLevel: 80,
      })

      expect(role).toBeDefined()
      expect(role.typeName).toBe('Role')
      const data = role.data as { name: string; permissions: string[] }
      expect(data.name).toBe('admin')
      expect(data.permissions).toContain('read:*')
      expect(data.permissions).toContain('write:*')
    })

    it('creates standard roles', async () => {
      const roles = await createStandardRoles(graph)

      expect(roles.owner).toBeDefined()
      expect(roles.admin).toBeDefined()
      expect(roles.member).toBeDefined()
      expect(roles.viewer).toBeDefined()

      const ownerData = roles.owner.data as { permissions: string[]; hierarchyLevel: number }
      expect(ownerData.permissions).toContain('*:*')
      expect(ownerData.hierarchyLevel).toBe(100)
    })
  })

  // ==========================================================================
  // HAS_ROLE RELATIONSHIP TESTS
  // ==========================================================================

  describe('hasRole Relationship (User -> Role)', () => {
    it('assigns role to user', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const role = await createRole(graph, { name: 'admin', permissions: ['admin:*'], hierarchyLevel: 80 })

      await assignRole(graph, user.id, role.id)

      const hasRole = await entityHasRole(graph, user.id, role.id)
      expect(hasRole).toBe(true)
    })

    it('checks user permissions via role', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const role = await createRole(graph, {
        name: 'editor',
        permissions: ['read:*', 'write:documents'],
        description: 'Editor with read and write access',
        hierarchyLevel: 40,
      })

      await assignRole(graph, user.id, role.id)

      const readResult = await checkRolePermission(graph, user.id, 'read:docs')
      expect(readResult.allowed).toBe(true) // read:* matches read:docs

      const writeResult = await checkRolePermission(graph, user.id, 'write:documents')
      expect(writeResult.allowed).toBe(true)

      const adminResult = await checkRolePermission(graph, user.id, 'admin:settings')
      expect(adminResult.allowed).toBe(false)
    })

    it('gets user roles', async () => {
      const user = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const role1 = await createRole(graph, { name: 'editor', permissions: ['read:*', 'write:*'], description: 'Editor role', hierarchyLevel: 40 })
      const role2 = await createRole(graph, { name: 'reviewer', permissions: ['review:*'], description: 'Reviewer role', hierarchyLevel: 30 })

      await assignRole(graph, user.id, role1.id)
      await assignRole(graph, user.id, role2.id)

      const roles = await getUserRoles(graph, user.id)
      expect(roles).toHaveLength(2)
    })
  })

  // ==========================================================================
  // APPROVAL WORKFLOW TESTS (verb form state encoding)
  // ==========================================================================

  describe('Approval Workflow (verb form: approve -> approving -> approved)', () => {
    it('creates approval request with pending status', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })

      const { thing, relationship } = await createApprovalRequest(graph, {
        title: 'Partnership Approval',
        message: 'Please approve the partnership with BigCorp',
        type: 'approval',
        priority: 'high',
        targetRole: 'ceo',
        requesterId: requester.id,
        sla: 4 * 60 * 60 * 1000, // 4 hours
      })

      expect(thing).toBeDefined()
      expect(thing.typeName).toBe('ApprovalRequest')
      expect(relationship.verb).toBe('approve') // Intent verb

      const { status } = await getApprovalStatus(graph, thing.id)
      expect(status).toBe('pending')
    })

    it('transitions approve -> approving when review starts', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const approver = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing } = await createApprovalRequest(graph, {
        title: 'Test Approval',
        message: 'Test message',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      })

      await startReview(graph, thing.id, approver.id)

      const { status, relationship } = await getApprovalStatus(graph, thing.id)
      expect(status).toBe('approving')
      expect(relationship?.verb).toBe('approving') // In-progress verb
    })

    it('transitions approving -> approved on approval', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const approver = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing } = await createApprovalRequest(graph, {
        title: 'Test Approval',
        message: 'Test message',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      })

      await startReview(graph, thing.id, approver.id)
      await approve(graph, thing.id, approver.id, 'Looks good!')

      const { status, relationship } = await getApprovalStatus(graph, thing.id)
      expect(status).toBe('approved')
      expect(relationship?.verb).toBe('approved') // Completed verb
    })

    it('transitions approving -> rejected on rejection', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const approver = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing } = await createApprovalRequest(graph, {
        title: 'Test Approval',
        message: 'Test message',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      })

      await startReview(graph, thing.id, approver.id)
      await reject(graph, thing.id, approver.id, 'Not approved')

      const { status, relationship } = await getApprovalStatus(graph, thing.id)
      expect(status).toBe('rejected')
      expect(relationship?.verb).toBe('rejected')
    })

    it('queries pending approvals for user', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const approver = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      await createApprovalRequest(graph, {
        title: 'Request 1',
        message: 'First request',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      }, { targetId: approver.id })

      await createApprovalRequest(graph, {
        title: 'Request 2',
        message: 'Second request',
        type: 'approval',
        priority: 'high',
        requesterId: requester.id,
      }, { targetId: approver.id })

      const pending = await getPendingApprovals(graph, approver.id)
      expect(pending).toHaveLength(2)
    })

    it('queries approval history for approver', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const approver = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing: req1 } = await createApprovalRequest(graph, {
        title: 'Request 1',
        message: 'First request',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      }, { targetId: approver.id })

      const { thing: req2 } = await createApprovalRequest(graph, {
        title: 'Request 2',
        message: 'Second request',
        type: 'approval',
        priority: 'normal',
        requesterId: requester.id,
      }, { targetId: approver.id })

      await approve(graph, req1.id, approver.id)
      await reject(graph, req2.id, approver.id)

      const history = await getApprovalHistory(graph, approver.id)
      expect(history).toHaveLength(2)

      const approved = await getApprovalHistory(graph, approver.id, { approved: true })
      expect(approved).toHaveLength(1)

      const rejected = await getApprovalHistory(graph, approver.id, { approved: false })
      expect(rejected).toHaveLength(1)
    })
  })

  // ==========================================================================
  // ESCALATION TESTS
  // ==========================================================================

  describe('Escalation (escalate -> escalating -> escalated)', () => {
    it('escalates approval to another user', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const manager = await createUser(graph, { email: 'manager@example.com', name: 'Manager', status: 'active' })
      const ceo = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing } = await createApprovalRequest(graph, {
        title: 'High Value Contract',
        message: 'Approve $1M contract',
        type: 'approval',
        priority: 'high',
        requesterId: requester.id,
      }, { targetId: manager.id })

      // Manager escalates to CEO
      const escalationRel = await escalateApproval(graph, thing.id, {
        toUserId: ceo.id,
        reason: 'Exceeds my approval limit',
        escalatedBy: manager.id,
        sla: 2 * 60 * 60 * 1000, // 2 hours
      })

      expect(escalationRel).toBeDefined()
      expect(escalationRel.verb).toBe('escalated')
      expect((escalationRel.data as { level: number }).level).toBe(1)
    })

    it('tracks escalation chain', async () => {
      const requester = await createUser(graph, { email: 'alice@example.com', name: 'Alice', status: 'active' })
      const support = await createUser(graph, { email: 'support@example.com', name: 'Support', status: 'active' })
      const manager = await createUser(graph, { email: 'manager@example.com', name: 'Manager', status: 'active' })
      const ceo = await createUser(graph, { email: 'ceo@example.com', name: 'CEO', status: 'active' })

      const { thing } = await createApprovalRequest(graph, {
        title: 'Complex Issue',
        message: 'Needs executive approval',
        type: 'approval',
        priority: 'urgent',
        requesterId: requester.id,
      }, { targetId: support.id })

      // Support -> Manager
      await escalateApproval(graph, thing.id, {
        toUserId: manager.id,
        reason: 'Beyond support scope',
        escalatedBy: support.id,
      })

      // Manager -> CEO
      await escalateApproval(graph, thing.id, {
        toUserId: ceo.id,
        reason: 'Requires CEO approval',
        escalatedBy: manager.id,
      })

      // Import getEscalationChain
      const { getEscalationChain } = await import('../humans/approval')
      const chain = await getEscalationChain(graph, thing.id)

      expect(chain).toHaveLength(2)
      expect((chain[0]!.relationship.data as { level: number }).level).toBe(1)
      expect((chain[1]!.relationship.data as { level: number }).level).toBe(2)
    })
  })

  // ==========================================================================
  // HUMAN ROLE TEMPLATES (ceo`approve`, legal`review`)
  // ==========================================================================

  describe('Human Role Templates', () => {
    it('defines standard human roles', () => {
      expect(HUMAN_ROLE_TEMPLATES.ceo).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.cfo).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.cto).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.legal).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.hr).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.manager).toBeDefined()
      expect(HUMAN_ROLE_TEMPLATES.support).toBeDefined()
    })

    it('creates human role templates for org', async () => {
      const org = await createOrg(graph, { name: 'Acme Inc', slug: 'acme', status: 'active' })

      const roles = await createHumanRoleTemplates(graph, org.id)

      expect(roles.ceo).toBeDefined()
      expect(roles.legal).toBeDefined()
      expect(Object.keys(roles)).toHaveLength(7)
    })

    it('CEO has highest hierarchy and all permissions', async () => {
      const roles = await createHumanRoleTemplates(graph)
      const ceoData = roles.ceo.data as { permissions: string[]; hierarchyLevel: number }

      expect(ceoData.permissions).toContain('approve:*')
      expect(ceoData.hierarchyLevel).toBe(100)
    })

    it('defines escalation paths', () => {
      expect(HUMAN_ROLE_TEMPLATES.cfo.escalatesTo).toBe('ceo')
      expect(HUMAN_ROLE_TEMPLATES.legal.escalatesTo).toBe('ceo')
      expect(HUMAN_ROLE_TEMPLATES.manager.escalatesTo).toBe('cfo')
      expect(HUMAN_ROLE_TEMPLATES.support.escalatesTo).toBe('manager')
      expect(HUMAN_ROLE_TEMPLATES.ceo.escalatesTo).toBeNull()
    })
  })

  // ==========================================================================
  // CONVENIENCE FUNCTION TESTS
  // ==========================================================================

  describe('Convenience Functions', () => {
    it('creates user with org in one operation', async () => {
      const { user, org, membership } = await createUserWithOrg(
        graph,
        { email: 'founder@startup.com', name: 'Founder' },
        { name: 'Startup Inc', slug: 'startup', status: 'active' },
        { role: 'owner' }
      )

      expect(user).toBeDefined()
      expect(org).toBeDefined()
      expect(membership.role).toBe('owner')
      expect(await isMember(graph, user.id, org.id)).toBe(true)
    })
  })

  // ==========================================================================
  // URL SCHEME TESTS
  // ==========================================================================

  describe('URL Schemes', () => {
    it('generates correct URLs for entities', () => {
      expect(HumanUrls.user('123')).toBe('auth://users/123')
      expect(HumanUrls.org('456')).toBe('auth://orgs/456')
      expect(HumanUrls.role('789')).toBe('auth://roles/789')
      expect(HumanUrls.session('abc')).toBe('auth://sessions/abc')
      expect(HumanUrls.approval('req-1')).toBe('requests://approvals/req-1')
    })

    it('extracts ID from URL', () => {
      expect(HumanUrls.extractId('auth://users/123')).toBe('123')
      expect(HumanUrls.extractId('requests://approvals/req-456')).toBe('req-456')
    })

    it('extracts entity type from URL', () => {
      expect(HumanUrls.extractType('auth://users/123')).toBe('User')
      expect(HumanUrls.extractType('auth://orgs/456')).toBe('Org')
      expect(HumanUrls.extractType('requests://approvals/789')).toBe('ApprovalRequest')
      expect(HumanUrls.extractType('unknown://something/123')).toBeNull()
    })
  })

  // ==========================================================================
  // TYPE ID CONSTANTS TESTS
  // ==========================================================================

  describe('Type Constants', () => {
    it('defines correct type IDs', () => {
      expect(HUMAN_TYPE_IDS.User).toBe(10)
      expect(HUMAN_TYPE_IDS.Organization).toBe(11)
      expect(HUMAN_TYPE_IDS.Role).toBe(12)
      expect(HUMAN_TYPE_IDS.Session).toBe(13)
      expect(HUMAN_TYPE_IDS.ApprovalRequest).toBe(16)
    })

    it('defines correct type names', () => {
      expect(HUMAN_TYPE_NAMES.User).toBe('User')
      expect(HUMAN_TYPE_NAMES.Organization).toBe('Org')
      expect(HUMAN_TYPE_NAMES.Role).toBe('Role')
      expect(HUMAN_TYPE_NAMES.ApprovalRequest).toBe('ApprovalRequest')
    })

    it('defines correct verb constants', () => {
      expect(HUMAN_VERBS.MEMBER_OF).toBe('memberOf')
      expect(HUMAN_VERBS.HAS_ROLE).toBe('hasRole')
      expect(HUMAN_VERBS.BELONGS_TO).toBe('belongsTo')
      expect(HUMAN_VERBS.APPROVE).toBe('approve')
      expect(HUMAN_VERBS.APPROVING).toBe('approving')
      expect(HUMAN_VERBS.APPROVED).toBe('approved')
      expect(HUMAN_VERBS.ESCALATED).toBe('escalated')
    })
  })
})
