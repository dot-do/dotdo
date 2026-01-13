/**
 * Organization Graph Tests - Organizations as Things with memberOf Relationships
 *
 * RED PHASE: These tests define the contract for storing Organizations as Things
 * in the graph model, with User memberOf relationships for team membership.
 *
 * @see dotdo-93idt - [RED] Organization as Thing: Graph storage tests
 *
 * These tests FAIL until Organization graph operations are implemented.
 *
 * Graph Model:
 * ```
 * User Thing ──memberOf──> Org Thing
 *             (data: { role: 'admin' })
 *
 * User Thing ──invited──> Org Thing (pending invitation)
 *             (data: { invitedBy: userId, invitedAt: timestamp })
 * ```
 *
 * Design:
 * - Organization is a Thing with type 'Organization'
 * - Membership is a Relationship with verb 'memberOf' and role data
 * - Invitations are Relationships with verb 'invited' and invitation metadata
 * - Uses SQLiteGraphStore for storage (NO MOCKS)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'crypto'
import { SQLiteGraphStore } from '../../db/graph/stores'
import type { GraphThing, GraphRelationship } from '../../db/graph/types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Organization entity as stored in the graph
 */
interface Organization {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: Record<string, unknown> | null
  tenantNs: string // DO namespace for multi-tenant integration
  createdAt: Date
  updatedAt: Date
}

/**
 * Organization data stored in Thing.data
 */
interface OrgData {
  name: string
  slug: string
  logo: string | null
  metadata: Record<string, unknown> | null
  tenantNs: string
}

/**
 * User data stored in Thing.data
 */
interface UserData {
  email: string
  name: string | null
}

/**
 * Membership role types
 */
type MemberRole = 'owner' | 'admin' | 'member'

/**
 * Membership relationship data
 */
interface MembershipData {
  role: MemberRole
  joinedAt: number // timestamp
}

/**
 * Invitation relationship data
 */
interface InvitationData {
  invitedBy: string // user ID who sent the invitation
  invitedAt: number // timestamp
  email: string // email of the invitee
  role: MemberRole // role they'll have if accepted
  expiresAt: number | null // optional expiration
}

// ============================================================================
// CONSTANTS
// ============================================================================

const TYPE_IDS = {
  User: 1,
  Organization: 6,
} as const

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate URL for organization entity
 */
function orgUrl(id: string): string {
  return `auth://organizations/${id}`
}

/**
 * Generate URL for user entity
 */
function userUrl(id: string): string {
  return `auth://users/${id}`
}

/**
 * Convert Thing to Organization
 */
function thingToOrg(thing: GraphThing): Organization {
  const data = thing.data as OrgData
  return {
    id: thing.id,
    name: data.name,
    slug: data.slug,
    logo: data.logo,
    metadata: data.metadata,
    tenantNs: data.tenantNs,
    createdAt: new Date(thing.createdAt),
    updatedAt: new Date(thing.updatedAt),
  }
}

// ============================================================================
// ORGANIZATION OPERATIONS (to be implemented)
// ============================================================================

/**
 * These functions represent the interface that will be implemented.
 * Currently they throw to make tests fail (RED phase).
 */

async function createOrg(
  _store: SQLiteGraphStore,
  _data: { name: string; slug: string; logo?: string | null; metadata?: Record<string, unknown> | null; tenantNs?: string }
): Promise<Organization> {
  throw new Error('createOrg not implemented')
}

async function getOrgById(_store: SQLiteGraphStore, _id: string): Promise<Organization | null> {
  throw new Error('getOrgById not implemented')
}

async function getOrgBySlug(_store: SQLiteGraphStore, _slug: string): Promise<Organization | null> {
  throw new Error('getOrgBySlug not implemented')
}

async function addMember(
  _store: SQLiteGraphStore,
  _orgId: string,
  _userId: string,
  _role: MemberRole
): Promise<GraphRelationship> {
  throw new Error('addMember not implemented')
}

async function removeMember(_store: SQLiteGraphStore, _orgId: string, _userId: string): Promise<boolean> {
  throw new Error('removeMember not implemented')
}

async function getOrgMembers(
  _store: SQLiteGraphStore,
  _orgId: string
): Promise<Array<{ userId: string; role: MemberRole; joinedAt: Date }>> {
  throw new Error('getOrgMembers not implemented')
}

async function getUserOrgs(
  _store: SQLiteGraphStore,
  _userId: string
): Promise<Array<{ org: Organization; role: MemberRole; joinedAt: Date }>> {
  throw new Error('getUserOrgs not implemented')
}

async function updateMemberRole(
  _store: SQLiteGraphStore,
  _orgId: string,
  _userId: string,
  _newRole: MemberRole
): Promise<GraphRelationship | null> {
  throw new Error('updateMemberRole not implemented')
}

async function createInvitation(
  _store: SQLiteGraphStore,
  _orgId: string,
  _invitedBy: string,
  _email: string,
  _role: MemberRole,
  _expiresAt?: Date
): Promise<GraphRelationship> {
  throw new Error('createInvitation not implemented')
}

async function getPendingInvitations(
  _store: SQLiteGraphStore,
  _orgId: string
): Promise<Array<{ email: string; role: MemberRole; invitedBy: string; invitedAt: Date; expiresAt: Date | null }>> {
  throw new Error('getPendingInvitations not implemented')
}

async function acceptInvitation(
  _store: SQLiteGraphStore,
  _orgId: string,
  _userId: string,
  _email: string
): Promise<GraphRelationship> {
  throw new Error('acceptInvitation not implemented')
}

async function cancelInvitation(_store: SQLiteGraphStore, _orgId: string, _email: string): Promise<boolean> {
  throw new Error('cancelInvitation not implemented')
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('[RED] Organization as Thing - Graph Storage', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // ORGANIZATION CREATION TESTS
  // ==========================================================================

  describe('Organization Creation', () => {
    it('creates Org Thing with name, slug, logo, metadata', async () => {
      const org = await createOrg(store, {
        name: 'Acme Corp',
        slug: 'acme',
        logo: 'https://example.com/acme-logo.png',
        metadata: { industry: 'technology', size: 'enterprise' },
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Acme Corp')
      expect(org.slug).toBe('acme')
      expect(org.logo).toBe('https://example.com/acme-logo.png')
      expect(org.metadata).toEqual({ industry: 'technology', size: 'enterprise' })
      expect(org.tenantNs).toBeDefined() // auto-generated if not provided
      expect(org.createdAt).toBeInstanceOf(Date)
      expect(org.updatedAt).toBeInstanceOf(Date)
    })

    it('creates Org Thing with minimal required fields', async () => {
      const org = await createOrg(store, {
        name: 'Simple Org',
        slug: 'simple',
      })

      expect(org.id).toBeDefined()
      expect(org.name).toBe('Simple Org')
      expect(org.slug).toBe('simple')
      expect(org.logo).toBeNull()
      expect(org.metadata).toBeNull()
    })

    it('creates Org Thing with custom tenantNs', async () => {
      const org = await createOrg(store, {
        name: 'Custom Tenant',
        slug: 'custom-tenant',
        tenantNs: 'custom-ns-12345',
      })

      expect(org.tenantNs).toBe('custom-ns-12345')
    })

    it('enforces unique slug constraint', async () => {
      await createOrg(store, {
        name: 'First Org',
        slug: 'unique-slug',
      })

      await expect(
        createOrg(store, {
          name: 'Second Org',
          slug: 'unique-slug', // duplicate slug
        })
      ).rejects.toThrow()
    })

    it('generates unique IDs for organizations', async () => {
      const org1 = await createOrg(store, { name: 'Org 1', slug: 'org-1' })
      const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })

      expect(org1.id).not.toBe(org2.id)
    })

    it('stores Organization as Thing with type "Organization"', async () => {
      const org = await createOrg(store, {
        name: 'Type Test Org',
        slug: 'type-test',
      })

      // Verify the Thing was created with correct type
      const thing = await store.getThing(org.id)
      expect(thing).not.toBeNull()
      expect(thing?.typeName).toBe('Organization')
      expect(thing?.typeId).toBe(TYPE_IDS.Organization)
    })

    it('auto-generates tenantNs from slug if not provided', async () => {
      const org = await createOrg(store, {
        name: 'Auto NS Org',
        slug: 'auto-ns-slug',
      })

      // tenantNs should be derived from slug or be a unique identifier
      expect(org.tenantNs).toBeDefined()
      expect(org.tenantNs.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // ORGANIZATION QUERY TESTS
  // ==========================================================================

  describe('Organization Queries', () => {
    describe('getOrgById', () => {
      it('retrieves organization by ID', async () => {
        const created = await createOrg(store, {
          name: 'Find Me Org',
          slug: 'find-me',
        })

        const org = await getOrgById(store, created.id)

        expect(org).not.toBeNull()
        expect(org?.id).toBe(created.id)
        expect(org?.name).toBe('Find Me Org')
        expect(org?.slug).toBe('find-me')
      })

      it('returns null for non-existent ID', async () => {
        const org = await getOrgById(store, 'non-existent-org-id')

        expect(org).toBeNull()
      })
    })

    describe('getOrgBySlug', () => {
      it('retrieves organization by slug', async () => {
        await createOrg(store, {
          name: 'Slug Test Org',
          slug: 'slug-test',
        })

        const org = await getOrgBySlug(store, 'slug-test')

        expect(org).not.toBeNull()
        expect(org?.name).toBe('Slug Test Org')
        expect(org?.slug).toBe('slug-test')
      })

      it('returns null for non-existent slug', async () => {
        const org = await getOrgBySlug(store, 'non-existent-slug')

        expect(org).toBeNull()
      })

      it('slug lookup is case-sensitive', async () => {
        await createOrg(store, {
          name: 'Case Sensitive',
          slug: 'CaseSensitive',
        })

        const org = await getOrgBySlug(store, 'casesensitive')
        expect(org).toBeNull()

        const exactMatch = await getOrgBySlug(store, 'CaseSensitive')
        expect(exactMatch).not.toBeNull()
      })
    })
  })

  // ==========================================================================
  // MEMBERSHIP RELATIONSHIP TESTS
  // ==========================================================================

  describe('Membership Relationships', () => {
    let testOrg: Organization
    let testUser1Id: string
    let testUser2Id: string
    let testUser3Id: string

    beforeEach(async () => {
      // Create test organization
      testOrg = await createOrg(store, {
        name: 'Test Org',
        slug: 'test-org',
      })

      // Create test users as Things
      testUser1Id = randomUUID()
      testUser2Id = randomUUID()
      testUser3Id = randomUUID()

      await store.createThing({
        id: testUser1Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'alice@example.com', name: 'Alice' } as UserData,
      })

      await store.createThing({
        id: testUser2Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'bob@example.com', name: 'Bob' } as UserData,
      })

      await store.createThing({
        id: testUser3Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'charlie@example.com', name: 'Charlie' } as UserData,
      })
    })

    describe('addMember', () => {
      it('creates memberOf relationship with owner role', async () => {
        const rel = await addMember(store, testOrg.id, testUser1Id, 'owner')

        expect(rel.id).toBeDefined()
        expect(rel.verb).toBe('memberOf')
        expect(rel.from).toBe(userUrl(testUser1Id))
        expect(rel.to).toBe(orgUrl(testOrg.id))

        const data = rel.data as MembershipData
        expect(data.role).toBe('owner')
        expect(data.joinedAt).toBeDefined()
      })

      it('creates memberOf relationship with admin role', async () => {
        const rel = await addMember(store, testOrg.id, testUser1Id, 'admin')

        const data = rel.data as MembershipData
        expect(data.role).toBe('admin')
      })

      it('creates memberOf relationship with member role', async () => {
        const rel = await addMember(store, testOrg.id, testUser1Id, 'member')

        const data = rel.data as MembershipData
        expect(data.role).toBe('member')
      })

      it('stores joinedAt timestamp', async () => {
        const before = Date.now()
        const rel = await addMember(store, testOrg.id, testUser1Id, 'member')
        const after = Date.now()

        const data = rel.data as MembershipData
        expect(data.joinedAt).toBeGreaterThanOrEqual(before)
        expect(data.joinedAt).toBeLessThanOrEqual(after)
      })

      it('allows multiple users per organization', async () => {
        await addMember(store, testOrg.id, testUser1Id, 'owner')
        await addMember(store, testOrg.id, testUser2Id, 'admin')
        await addMember(store, testOrg.id, testUser3Id, 'member')

        const members = await getOrgMembers(store, testOrg.id)
        expect(members.length).toBe(3)
      })

      it('prevents duplicate membership', async () => {
        await addMember(store, testOrg.id, testUser1Id, 'member')

        await expect(addMember(store, testOrg.id, testUser1Id, 'admin')).rejects.toThrow()
      })
    })

    describe('multiple orgs per user', () => {
      it('allows user to be member of multiple organizations', async () => {
        const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })
        const org3 = await createOrg(store, { name: 'Org 3', slug: 'org-3' })

        await addMember(store, testOrg.id, testUser1Id, 'owner')
        await addMember(store, org2.id, testUser1Id, 'admin')
        await addMember(store, org3.id, testUser1Id, 'member')

        const userOrgs = await getUserOrgs(store, testUser1Id)
        expect(userOrgs.length).toBe(3)
      })

      it('tracks different roles in different organizations', async () => {
        const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })

        await addMember(store, testOrg.id, testUser1Id, 'owner')
        await addMember(store, org2.id, testUser1Id, 'member')

        const userOrgs = await getUserOrgs(store, testUser1Id)

        const testOrgMembership = userOrgs.find((m) => m.org.id === testOrg.id)
        const org2Membership = userOrgs.find((m) => m.org.id === org2.id)

        expect(testOrgMembership?.role).toBe('owner')
        expect(org2Membership?.role).toBe('member')
      })
    })

    describe('removeMember', () => {
      it('removes membership relationship', async () => {
        await addMember(store, testOrg.id, testUser1Id, 'member')

        const removed = await removeMember(store, testOrg.id, testUser1Id)
        expect(removed).toBe(true)

        const members = await getOrgMembers(store, testOrg.id)
        expect(members.find((m) => m.userId === testUser1Id)).toBeUndefined()
      })

      it('returns false for non-existent membership', async () => {
        const removed = await removeMember(store, testOrg.id, 'non-existent-user')
        expect(removed).toBe(false)
      })

      it('does not affect other members', async () => {
        await addMember(store, testOrg.id, testUser1Id, 'owner')
        await addMember(store, testOrg.id, testUser2Id, 'admin')

        await removeMember(store, testOrg.id, testUser1Id)

        const members = await getOrgMembers(store, testOrg.id)
        expect(members.length).toBe(1)
        expect(members[0]?.userId).toBe(testUser2Id)
      })
    })

    describe('updateMemberRole', () => {
      it('updates member role from member to admin', async () => {
        await addMember(store, testOrg.id, testUser1Id, 'member')

        const updated = await updateMemberRole(store, testOrg.id, testUser1Id, 'admin')

        expect(updated).not.toBeNull()
        const data = updated?.data as MembershipData
        expect(data.role).toBe('admin')
      })

      it('preserves joinedAt when updating role', async () => {
        const original = await addMember(store, testOrg.id, testUser1Id, 'member')
        const originalData = original.data as MembershipData

        // Small delay to ensure time difference if joinedAt were regenerated
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await updateMemberRole(store, testOrg.id, testUser1Id, 'admin')
        const updatedData = updated?.data as MembershipData

        expect(updatedData.joinedAt).toBe(originalData.joinedAt)
      })

      it('returns null for non-existent membership', async () => {
        const updated = await updateMemberRole(store, testOrg.id, 'non-existent-user', 'admin')
        expect(updated).toBeNull()
      })
    })
  })

  // ==========================================================================
  // ORGANIZATION MEMBER QUERIES
  // ==========================================================================

  describe('Organization Member Queries', () => {
    let testOrg: Organization
    let testUser1Id: string
    let testUser2Id: string
    let testUser3Id: string

    beforeEach(async () => {
      testOrg = await createOrg(store, {
        name: 'Query Test Org',
        slug: 'query-test',
      })

      testUser1Id = randomUUID()
      testUser2Id = randomUUID()
      testUser3Id = randomUUID()

      await store.createThing({
        id: testUser1Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'alice@example.com', name: 'Alice' } as UserData,
      })

      await store.createThing({
        id: testUser2Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'bob@example.com', name: 'Bob' } as UserData,
      })

      await store.createThing({
        id: testUser3Id,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'charlie@example.com', name: 'Charlie' } as UserData,
      })

      // Set up members
      await addMember(store, testOrg.id, testUser1Id, 'owner')
      await addMember(store, testOrg.id, testUser2Id, 'admin')
      await addMember(store, testOrg.id, testUser3Id, 'member')
    })

    describe('getOrgMembers (backward traversal)', () => {
      it('retrieves all members of an organization', async () => {
        const members = await getOrgMembers(store, testOrg.id)

        expect(members.length).toBe(3)
        expect(members.map((m) => m.userId).sort()).toEqual([testUser1Id, testUser2Id, testUser3Id].sort())
      })

      it('includes role for each member', async () => {
        const members = await getOrgMembers(store, testOrg.id)

        const owner = members.find((m) => m.userId === testUser1Id)
        const admin = members.find((m) => m.userId === testUser2Id)
        const member = members.find((m) => m.userId === testUser3Id)

        expect(owner?.role).toBe('owner')
        expect(admin?.role).toBe('admin')
        expect(member?.role).toBe('member')
      })

      it('includes joinedAt timestamp', async () => {
        const members = await getOrgMembers(store, testOrg.id)

        for (const member of members) {
          expect(member.joinedAt).toBeInstanceOf(Date)
        }
      })

      it('returns empty array for org with no members', async () => {
        const emptyOrg = await createOrg(store, { name: 'Empty Org', slug: 'empty' })

        const members = await getOrgMembers(store, emptyOrg.id)
        expect(members).toHaveLength(0)
      })

      it('uses backward traversal to find members', async () => {
        // Verify via direct graph query that backward traversal works
        const rels = await store.queryRelationshipsTo(orgUrl(testOrg.id), { verb: 'memberOf' })

        expect(rels.length).toBe(3)
        expect(rels.every((r) => r.verb === 'memberOf')).toBe(true)
        expect(rels.every((r) => r.to === orgUrl(testOrg.id))).toBe(true)
      })
    })

    describe('getUserOrgs (forward traversal)', () => {
      it('retrieves all organizations for a user', async () => {
        const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })
        await addMember(store, org2.id, testUser1Id, 'member')

        const userOrgs = await getUserOrgs(store, testUser1Id)

        expect(userOrgs.length).toBe(2)
        expect(userOrgs.map((o) => o.org.id).sort()).toEqual([testOrg.id, org2.id].sort())
      })

      it('includes role for each organization', async () => {
        const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })
        await addMember(store, org2.id, testUser1Id, 'admin')

        const userOrgs = await getUserOrgs(store, testUser1Id)

        const testOrgMembership = userOrgs.find((o) => o.org.id === testOrg.id)
        const org2Membership = userOrgs.find((o) => o.org.id === org2.id)

        expect(testOrgMembership?.role).toBe('owner')
        expect(org2Membership?.role).toBe('admin')
      })

      it('returns empty array for user with no organizations', async () => {
        const lonelyUserId = randomUUID()
        await store.createThing({
          id: lonelyUserId,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: { email: 'lonely@example.com', name: 'Lonely' } as UserData,
        })

        const userOrgs = await getUserOrgs(store, lonelyUserId)
        expect(userOrgs).toHaveLength(0)
      })

      it('uses forward traversal from user to orgs', async () => {
        // Verify via direct graph query that forward traversal works
        const rels = await store.queryRelationshipsFrom(userUrl(testUser1Id), { verb: 'memberOf' })

        expect(rels.length).toBe(1)
        expect(rels[0]?.verb).toBe('memberOf')
        expect(rels[0]?.from).toBe(userUrl(testUser1Id))
        expect(rels[0]?.to).toBe(orgUrl(testOrg.id))
      })
    })
  })

  // ==========================================================================
  // INVITATION FLOW TESTS
  // ==========================================================================

  describe('Invitation Flow (as Relationships)', () => {
    let testOrg: Organization
    let ownerUserId: string

    beforeEach(async () => {
      testOrg = await createOrg(store, {
        name: 'Invitation Test Org',
        slug: 'invitation-test',
      })

      ownerUserId = randomUUID()
      await store.createThing({
        id: ownerUserId,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'owner@example.com', name: 'Owner' } as UserData,
      })

      await addMember(store, testOrg.id, ownerUserId, 'owner')
    })

    describe('createInvitation', () => {
      it('creates invitation relationship with invite verb', async () => {
        const rel = await createInvitation(store, testOrg.id, ownerUserId, 'newuser@example.com', 'member')

        expect(rel.id).toBeDefined()
        expect(rel.verb).toBe('invited')
        expect(rel.to).toBe(orgUrl(testOrg.id))
        // From is a synthetic node representing the pending invitation
        expect(rel.from).toContain('auth://invitations/')
      })

      it('stores invitation metadata in relationship data', async () => {
        const before = Date.now()
        const rel = await createInvitation(store, testOrg.id, ownerUserId, 'invitee@example.com', 'admin')
        const after = Date.now()

        const data = rel.data as InvitationData
        expect(data.invitedBy).toBe(ownerUserId)
        expect(data.email).toBe('invitee@example.com')
        expect(data.role).toBe('admin')
        expect(data.invitedAt).toBeGreaterThanOrEqual(before)
        expect(data.invitedAt).toBeLessThanOrEqual(after)
      })

      it('creates invitation with expiration date', async () => {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        const rel = await createInvitation(store, testOrg.id, ownerUserId, 'expiring@example.com', 'member', expiresAt)

        const data = rel.data as InvitationData
        expect(data.expiresAt).toBe(expiresAt.getTime())
      })

      it('creates invitation without expiration', async () => {
        const rel = await createInvitation(store, testOrg.id, ownerUserId, 'noexpire@example.com', 'member')

        const data = rel.data as InvitationData
        expect(data.expiresAt).toBeNull()
      })

      it('prevents duplicate invitations for same email to same org', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'duplicate@example.com', 'member')

        await expect(createInvitation(store, testOrg.id, ownerUserId, 'duplicate@example.com', 'admin')).rejects.toThrow()
      })

      it('allows same email to be invited to different orgs', async () => {
        const org2 = await createOrg(store, { name: 'Org 2', slug: 'org-2' })
        await addMember(store, org2.id, ownerUserId, 'owner')

        await createInvitation(store, testOrg.id, ownerUserId, 'multiorg@example.com', 'member')
        const rel2 = await createInvitation(store, org2.id, ownerUserId, 'multiorg@example.com', 'admin')

        expect(rel2).toBeDefined()
      })
    })

    describe('getPendingInvitations', () => {
      it('retrieves all pending invitations for an organization', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'pending1@example.com', 'member')
        await createInvitation(store, testOrg.id, ownerUserId, 'pending2@example.com', 'admin')
        await createInvitation(store, testOrg.id, ownerUserId, 'pending3@example.com', 'member')

        const invitations = await getPendingInvitations(store, testOrg.id)

        expect(invitations.length).toBe(3)
        expect(invitations.map((i) => i.email).sort()).toEqual(
          ['pending1@example.com', 'pending2@example.com', 'pending3@example.com'].sort()
        )
      })

      it('includes all invitation metadata', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'detailed@example.com', 'admin')

        const invitations = await getPendingInvitations(store, testOrg.id)
        const invitation = invitations.find((i) => i.email === 'detailed@example.com')

        expect(invitation).toBeDefined()
        expect(invitation?.role).toBe('admin')
        expect(invitation?.invitedBy).toBe(ownerUserId)
        expect(invitation?.invitedAt).toBeInstanceOf(Date)
      })

      it('returns empty array for org with no pending invitations', async () => {
        const invitations = await getPendingInvitations(store, testOrg.id)
        expect(invitations).toHaveLength(0)
      })

      it('excludes expired invitations', async () => {
        const expiredDate = new Date(Date.now() - 1000) // Already expired
        await createInvitation(store, testOrg.id, ownerUserId, 'expired@example.com', 'member', expiredDate)
        await createInvitation(store, testOrg.id, ownerUserId, 'valid@example.com', 'member')

        const invitations = await getPendingInvitations(store, testOrg.id)

        expect(invitations.length).toBe(1)
        expect(invitations[0]?.email).toBe('valid@example.com')
      })
    })

    describe('acceptInvitation', () => {
      it('converts invitation to membership', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'accepting@example.com', 'admin')

        // Create the user account
        const newUserId = randomUUID()
        await store.createThing({
          id: newUserId,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: { email: 'accepting@example.com', name: 'New User' } as UserData,
        })

        const membership = await acceptInvitation(store, testOrg.id, newUserId, 'accepting@example.com')

        expect(membership.verb).toBe('memberOf')
        const data = membership.data as MembershipData
        expect(data.role).toBe('admin') // Inherits role from invitation
      })

      it('removes the invitation relationship after acceptance', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'removeinvite@example.com', 'member')

        const newUserId = randomUUID()
        await store.createThing({
          id: newUserId,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: { email: 'removeinvite@example.com', name: 'New User' } as UserData,
        })

        await acceptInvitation(store, testOrg.id, newUserId, 'removeinvite@example.com')

        const pendingInvitations = await getPendingInvitations(store, testOrg.id)
        expect(pendingInvitations.find((i) => i.email === 'removeinvite@example.com')).toBeUndefined()
      })

      it('throws for non-existent invitation', async () => {
        const newUserId = randomUUID()
        await store.createThing({
          id: newUserId,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: { email: 'notinvited@example.com', name: 'Not Invited' } as UserData,
        })

        await expect(acceptInvitation(store, testOrg.id, newUserId, 'notinvited@example.com')).rejects.toThrow()
      })

      it('throws for expired invitation', async () => {
        const expiredDate = new Date(Date.now() - 1000)
        await createInvitation(store, testOrg.id, ownerUserId, 'expiredaccept@example.com', 'member', expiredDate)

        const newUserId = randomUUID()
        await store.createThing({
          id: newUserId,
          typeId: TYPE_IDS.User,
          typeName: 'User',
          data: { email: 'expiredaccept@example.com', name: 'Expired User' } as UserData,
        })

        await expect(acceptInvitation(store, testOrg.id, newUserId, 'expiredaccept@example.com')).rejects.toThrow()
      })
    })

    describe('cancelInvitation', () => {
      it('removes pending invitation', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'cancel@example.com', 'member')

        const cancelled = await cancelInvitation(store, testOrg.id, 'cancel@example.com')
        expect(cancelled).toBe(true)

        const invitations = await getPendingInvitations(store, testOrg.id)
        expect(invitations.find((i) => i.email === 'cancel@example.com')).toBeUndefined()
      })

      it('returns false for non-existent invitation', async () => {
        const cancelled = await cancelInvitation(store, testOrg.id, 'notexist@example.com')
        expect(cancelled).toBe(false)
      })

      it('does not affect other invitations', async () => {
        await createInvitation(store, testOrg.id, ownerUserId, 'keep@example.com', 'member')
        await createInvitation(store, testOrg.id, ownerUserId, 'remove@example.com', 'admin')

        await cancelInvitation(store, testOrg.id, 'remove@example.com')

        const invitations = await getPendingInvitations(store, testOrg.id)
        expect(invitations.length).toBe(1)
        expect(invitations[0]?.email).toBe('keep@example.com')
      })
    })
  })

  // ==========================================================================
  // GRAPH MODEL VERIFICATION
  // ==========================================================================

  describe('Graph Model Verification', () => {
    it('Organization stored as Thing with correct URL scheme', async () => {
      const org = await createOrg(store, {
        name: 'URL Test Org',
        slug: 'url-test',
      })

      // Verify URL format
      expect(orgUrl(org.id)).toBe(`auth://organizations/${org.id}`)
    })

    it('memberOf relationships use correct URL scheme', async () => {
      const org = await createOrg(store, {
        name: 'Rel URL Org',
        slug: 'rel-url',
      })

      const userId = randomUUID()
      await store.createThing({
        id: userId,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'relurl@example.com', name: 'Rel URL' } as UserData,
      })

      await addMember(store, org.id, userId, 'member')

      // Query directly via graph store
      const rels = await store.queryRelationshipsFrom(userUrl(userId), { verb: 'memberOf' })

      expect(rels.length).toBe(1)
      expect(rels[0]?.from).toBe(`auth://users/${userId}`)
      expect(rels[0]?.to).toBe(`auth://organizations/${org.id}`)
    })

    it('supports bidirectional traversal', async () => {
      const org = await createOrg(store, {
        name: 'Traversal Org',
        slug: 'traversal',
      })

      const userId = randomUUID()
      await store.createThing({
        id: userId,
        typeId: TYPE_IDS.User,
        typeName: 'User',
        data: { email: 'traversal@example.com', name: 'Traversal' } as UserData,
      })

      await addMember(store, org.id, userId, 'admin')

      // Forward traversal: User -> Orgs
      const forwardRels = await store.queryRelationshipsFrom(userUrl(userId), { verb: 'memberOf' })
      expect(forwardRels.length).toBe(1)
      expect(forwardRels[0]?.to).toBe(orgUrl(org.id))

      // Backward traversal: Org -> Users
      const backwardRels = await store.queryRelationshipsTo(orgUrl(org.id), { verb: 'memberOf' })
      expect(backwardRels.length).toBe(1)
      expect(backwardRels[0]?.from).toBe(userUrl(userId))
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles unicode in organization name', async () => {
      const org = await createOrg(store, {
        name: 'Unicode Org Name',
        slug: 'unicode-org',
      })

      const retrieved = await getOrgById(store, org.id)
      expect(retrieved?.name).toBe('Unicode Org Name')
    })

    it('handles long organization names', async () => {
      const longName = 'A'.repeat(500)
      const org = await createOrg(store, {
        name: longName,
        slug: 'long-name-org',
      })

      const retrieved = await getOrgById(store, org.id)
      expect(retrieved?.name).toBe(longName)
    })

    it('handles complex metadata objects', async () => {
      const complexMetadata = {
        settings: {
          features: ['feature1', 'feature2'],
          limits: { maxUsers: 100, maxProjects: 50 },
        },
        nested: {
          deeply: {
            nested: {
              value: 'test',
            },
          },
        },
      }

      const org = await createOrg(store, {
        name: 'Complex Metadata',
        slug: 'complex-metadata',
        metadata: complexMetadata,
      })

      const retrieved = await getOrgById(store, org.id)
      expect(retrieved?.metadata).toEqual(complexMetadata)
    })

    it('handles concurrent member additions', async () => {
      const org = await createOrg(store, {
        name: 'Concurrent Org',
        slug: 'concurrent',
      })

      const userIds = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const userId = randomUUID()
          await store.createThing({
            id: userId,
            typeId: TYPE_IDS.User,
            typeName: 'User',
            data: { email: `concurrent${i}@example.com`, name: `User ${i}` } as UserData,
          })
          return userId
        })
      )

      // Add all members concurrently
      await Promise.all(userIds.map((userId) => addMember(store, org.id, userId, 'member')))

      const members = await getOrgMembers(store, org.id)
      expect(members.length).toBe(10)
    })

    it('handles empty slug gracefully', async () => {
      // Empty slugs should be rejected
      await expect(
        createOrg(store, {
          name: 'No Slug Org',
          slug: '',
        })
      ).rejects.toThrow()
    })

    it('handles special characters in slug', async () => {
      // Slugs with special characters should work or be normalized
      const org = await createOrg(store, {
        name: 'Special Slug',
        slug: 'my-special-slug-123',
      })

      expect(org.slug).toBe('my-special-slug-123')
    })
  })
})
