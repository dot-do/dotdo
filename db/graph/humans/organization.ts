/**
 * Organization Graph Store
 *
 * CRUD operations for Organization Things in the graph model, plus relationship
 * management for User memberOf Org.
 *
 * @module db/graph/humans/organization
 */

import type { GraphStore, GraphThing } from '../types'
import {
  HUMAN_TYPE_IDS,
  HUMAN_TYPE_NAMES,
  HUMAN_VERBS,
  HumanUrls,
  type OrgThingData,
  type OrgStatus,
  type OrgMembershipData,
  type InvitationThingData,
  type InvitationStatus,
  isOrgThingData,
} from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

export const ORG_TYPE_ID = HUMAN_TYPE_IDS.Organization
export const ORG_TYPE_NAME = HUMAN_TYPE_NAMES.Organization
export const INVITATION_TYPE_ID = HUMAN_TYPE_IDS.Invitation
export const INVITATION_TYPE_NAME = HUMAN_TYPE_NAMES.Invitation

// ============================================================================
// ORGANIZATION CRUD
// ============================================================================

/**
 * Create a new Organization Thing
 */
export async function createOrg(
  graph: GraphStore,
  data: OrgThingData,
  options?: { id?: string }
): Promise<GraphThing> {
  // Check slug uniqueness
  const existing = await getOrgBySlug(graph, data.slug)
  if (existing) {
    throw new Error(`Organization with slug '${data.slug}' already exists`)
  }

  const orgId = options?.id ?? `org-${crypto.randomUUID()}`

  return graph.createThing({
    id: orgId,
    typeId: ORG_TYPE_ID,
    typeName: ORG_TYPE_NAME,
    data: {
      ...data,
      slug: data.slug.toLowerCase().trim(),
      status: data.status || 'active',
    },
  })
}

/**
 * Get an Organization Thing by ID
 */
export async function getOrg(graph: GraphStore, orgId: string): Promise<GraphThing | null> {
  const thing = await graph.getThing(orgId)
  if (!thing || thing.typeName !== ORG_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Get an Organization Thing by slug
 */
export async function getOrgBySlug(graph: GraphStore, slug: string): Promise<GraphThing | null> {
  const normalizedSlug = slug.toLowerCase().trim()
  const orgs = await graph.getThingsByType({
    typeName: ORG_TYPE_NAME,
    limit: 1000,
  })

  return orgs.find((o) => {
    const data = o.data as OrgThingData | null
    return data?.slug?.toLowerCase() === normalizedSlug && o.deletedAt === null
  }) ?? null
}

/**
 * List all organizations
 */
export async function listOrgs(
  graph: GraphStore,
  options?: { status?: OrgStatus; limit?: number; offset?: number }
): Promise<GraphThing[]> {
  let orgs = await graph.getThingsByType({
    typeName: ORG_TYPE_NAME,
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  })

  if (options?.status) {
    orgs = orgs.filter((o) => {
      const data = o.data as OrgThingData | null
      return data?.status === options.status
    })
  }

  return orgs
}

/**
 * Update an Organization Thing
 */
export async function updateOrg(
  graph: GraphStore,
  orgId: string,
  updates: Partial<OrgThingData>
): Promise<GraphThing | null> {
  const existing = await getOrg(graph, orgId)
  if (!existing) return null

  const existingData = (existing.data as OrgThingData) ?? {
    name: '',
    slug: '',
    status: 'active' as OrgStatus,
  }

  // If slug is being changed, validate uniqueness
  if (updates.slug && updates.slug.toLowerCase() !== existingData.slug.toLowerCase()) {
    const duplicate = await getOrgBySlug(graph, updates.slug)
    if (duplicate && duplicate.id !== orgId) {
      throw new Error(`Organization with slug '${updates.slug}' already exists`)
    }
  }

  const newData: OrgThingData = {
    ...existingData,
    ...updates,
    slug: updates.slug?.toLowerCase().trim() ?? existingData.slug,
  }

  return graph.updateThing(orgId, { data: newData })
}

/**
 * Delete (soft-delete) an Organization Thing
 */
export async function deleteOrg(graph: GraphStore, orgId: string): Promise<GraphThing | null> {
  const org = await getOrg(graph, orgId)
  if (!org) return null

  // Update status to archived before soft-delete
  await updateOrg(graph, orgId, { status: 'archived' })

  return graph.deleteThing(orgId)
}

/**
 * Suspend an organization
 */
export async function suspendOrg(
  graph: GraphStore,
  orgId: string,
  reason?: string
): Promise<GraphThing | null> {
  return updateOrg(graph, orgId, {
    status: 'suspended',
    metadata: reason ? { suspendedReason: reason, suspendedAt: Date.now() } : undefined,
  })
}

/**
 * Reactivate a suspended organization
 */
export async function reactivateOrg(graph: GraphStore, orgId: string): Promise<GraphThing | null> {
  const org = await getOrg(graph, orgId)
  if (!org) return null

  const data = org.data as OrgThingData | null
  if (data?.status !== 'suspended') {
    throw new Error(`Organization ${orgId} is not suspended`)
  }

  return updateOrg(graph, orgId, {
    status: 'active',
    metadata: { reactivatedAt: Date.now() },
  })
}

// ============================================================================
// MEMBERSHIP RELATIONSHIPS (memberOf)
// ============================================================================

/**
 * Add a user to an organization
 */
export async function addMember(
  graph: GraphStore,
  userId: string,
  orgId: string,
  membership?: Partial<OrgMembershipData>
): Promise<void> {
  // Verify org exists
  const org = await getOrg(graph, orgId)
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`)
  }

  // Verify user exists
  const user = await graph.getThing(userId)
  if (!user || user.deletedAt !== null) {
    throw new Error(`User not found: ${userId}`)
  }

  // Check if already a member
  const existing = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })
  const alreadyMember = existing.some((rel) => rel.to === orgId)
  if (alreadyMember) {
    return // Already a member
  }

  // Create memberOf relationship
  await graph.createRelationship({
    id: `${userId}-${HUMAN_VERBS.MEMBER_OF}-${orgId}-${Date.now()}`,
    verb: HUMAN_VERBS.MEMBER_OF,
    from: userId,
    to: orgId,
    data: {
      role: membership?.role ?? 'member',
      joinedAt: membership?.joinedAt ?? Date.now(),
      invitedBy: membership?.invitedBy,
      title: membership?.title,
      department: membership?.department,
      ...membership?.metadata,
    } satisfies OrgMembershipData,
  })
}

/**
 * Remove a user from an organization
 */
export async function removeMember(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })
  const toRemove = relationships.find((rel) => rel.to === orgId)

  if (!toRemove) {
    return false
  }

  return graph.deleteRelationship(toRemove.id)
}

/**
 * Update a member's role or metadata in an organization
 */
export async function updateMember(
  graph: GraphStore,
  userId: string,
  orgId: string,
  updates: Partial<OrgMembershipData>
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })
  const membership = relationships.find((rel) => rel.to === orgId)

  if (!membership) {
    return false
  }

  const existingData = (membership.data as OrgMembershipData) ?? {
    role: 'member',
    joinedAt: Date.now(),
  }

  // Delete old relationship and create new one with updated data
  await graph.deleteRelationship(membership.id)
  await graph.createRelationship({
    id: `${userId}-${HUMAN_VERBS.MEMBER_OF}-${orgId}-${Date.now()}`,
    verb: HUMAN_VERBS.MEMBER_OF,
    from: userId,
    to: orgId,
    data: {
      ...existingData,
      ...updates,
    },
  })

  return true
}

/**
 * Get all members of an organization
 */
export async function getOrgMembers(
  graph: GraphStore,
  orgId: string,
  options?: { role?: string; limit?: number }
): Promise<Array<{ user: GraphThing; membership: OrgMembershipData }>> {
  const relationships = await graph.queryRelationshipsTo(orgId, { verb: HUMAN_VERBS.MEMBER_OF })

  const results: Array<{ user: GraphThing; membership: OrgMembershipData }> = []

  for (const rel of relationships) {
    const user = await graph.getThing(rel.from)
    if (user && user.deletedAt === null) {
      const membership = (rel.data as OrgMembershipData) ?? { role: 'member', joinedAt: Date.now() }

      // Filter by role if specified
      if (!options?.role || membership.role === options.role) {
        results.push({ user, membership })
      }
    }
  }

  // Apply limit
  if (options?.limit && results.length > options.limit) {
    return results.slice(0, options.limit)
  }

  return results
}

/**
 * Get all organizations a user belongs to
 */
export async function getUserOrgs(
  graph: GraphStore,
  userId: string
): Promise<Array<{ org: GraphThing; membership: OrgMembershipData }>> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })

  const results: Array<{ org: GraphThing; membership: OrgMembershipData }> = []

  for (const rel of relationships) {
    const org = await getOrg(graph, rel.to)
    if (org) {
      results.push({
        org,
        membership: (rel.data as OrgMembershipData) ?? { role: 'member', joinedAt: Date.now() },
      })
    }
  }

  return results
}

/**
 * Check if a user is a member of an organization
 */
export async function isMember(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })
  return relationships.some((rel) => rel.to === orgId)
}

/**
 * Get a user's role in an organization
 */
export async function getMemberRole(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<string | null> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: HUMAN_VERBS.MEMBER_OF })
  const membership = relationships.find((rel) => rel.to === orgId)

  if (!membership) return null

  return (membership.data as OrgMembershipData)?.role ?? 'member'
}

/**
 * Get members count for an organization
 */
export async function getMemberCount(graph: GraphStore, orgId: string): Promise<number> {
  const relationships = await graph.queryRelationshipsTo(orgId, { verb: HUMAN_VERBS.MEMBER_OF })
  return relationships.length
}

// ============================================================================
// INVITATION WORKFLOW
// ============================================================================

/**
 * Create an invitation to join an organization
 */
export async function createInvitation(
  graph: GraphStore,
  data: {
    email: string
    orgId: string
    role: string
    invitedBy: string
    message?: string
    expiresIn?: number // milliseconds, default 7 days
  }
): Promise<GraphThing> {
  // Verify org exists
  const org = await getOrg(graph, data.orgId)
  if (!org) {
    throw new Error(`Organization not found: ${data.orgId}`)
  }

  const invitationId = `inv-${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const expiresIn = data.expiresIn ?? 7 * 24 * 60 * 60 * 1000 // 7 days default

  const invitationData: InvitationThingData = {
    email: data.email.toLowerCase().trim(),
    orgId: data.orgId,
    role: data.role,
    status: 'pending',
    invitedBy: data.invitedBy,
    expiresAt: Date.now() + expiresIn,
    message: data.message,
    token,
    sentAt: Date.now(),
  }

  const invitation = await graph.createThing({
    id: invitationId,
    typeId: INVITATION_TYPE_ID,
    typeName: INVITATION_TYPE_NAME,
    data: invitationData,
  })

  // Create invitedBy relationship
  await graph.createRelationship({
    id: `${invitationId}-${HUMAN_VERBS.INVITED_BY}-${data.invitedBy}`,
    verb: HUMAN_VERBS.INVITED_BY,
    from: invitationId,
    to: data.invitedBy,
  })

  return invitation
}

/**
 * Get an invitation by ID
 */
export async function getInvitation(
  graph: GraphStore,
  invitationId: string
): Promise<GraphThing | null> {
  const thing = await graph.getThing(invitationId)
  if (!thing || thing.typeName !== INVITATION_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Get an invitation by token
 */
export async function getInvitationByToken(
  graph: GraphStore,
  token: string
): Promise<GraphThing | null> {
  const invitations = await graph.getThingsByType({
    typeName: INVITATION_TYPE_NAME,
    limit: 1000,
  })

  return invitations.find((inv) => {
    const data = inv.data as InvitationThingData | null
    return data?.token === token && inv.deletedAt === null
  }) ?? null
}

/**
 * Get pending invitations for an organization
 */
export async function getPendingInvitations(
  graph: GraphStore,
  orgId: string
): Promise<GraphThing[]> {
  const invitations = await graph.getThingsByType({
    typeName: INVITATION_TYPE_NAME,
    limit: 1000,
  })

  return invitations.filter((inv) => {
    const data = inv.data as InvitationThingData | null
    return (
      data?.orgId === orgId &&
      data?.status === 'pending' &&
      inv.deletedAt === null
    )
  })
}

/**
 * Accept an invitation
 */
export async function acceptInvitation(
  graph: GraphStore,
  invitationId: string,
  userId: string
): Promise<{ org: GraphThing; membership: OrgMembershipData }> {
  const invitation = await getInvitation(graph, invitationId)
  if (!invitation) {
    throw new Error(`Invitation not found: ${invitationId}`)
  }

  const data = invitation.data as InvitationThingData
  if (data.status !== 'pending') {
    throw new Error(`Invitation is not pending: ${data.status}`)
  }

  if (data.expiresAt < Date.now()) {
    // Update status to expired
    await graph.updateThing(invitationId, {
      data: { ...data, status: 'expired' },
    })
    throw new Error('Invitation has expired')
  }

  // Add user to organization
  const membership: OrgMembershipData = {
    role: data.role,
    joinedAt: Date.now(),
    invitedBy: data.invitedBy,
  }
  await addMember(graph, userId, data.orgId, membership)

  // Update invitation status
  await graph.updateThing(invitationId, {
    data: { ...data, status: 'accepted', acceptedAt: Date.now() },
  })

  const org = await getOrg(graph, data.orgId)
  if (!org) {
    throw new Error(`Organization not found: ${data.orgId}`)
  }

  return { org, membership }
}

/**
 * Decline an invitation
 */
export async function declineInvitation(
  graph: GraphStore,
  invitationId: string
): Promise<void> {
  const invitation = await getInvitation(graph, invitationId)
  if (!invitation) {
    throw new Error(`Invitation not found: ${invitationId}`)
  }

  const data = invitation.data as InvitationThingData
  if (data.status !== 'pending') {
    throw new Error(`Invitation is not pending: ${data.status}`)
  }

  await graph.updateThing(invitationId, {
    data: { ...data, status: 'declined' },
  })
}

/**
 * Cancel an invitation
 */
export async function cancelInvitation(
  graph: GraphStore,
  invitationId: string
): Promise<void> {
  const invitation = await getInvitation(graph, invitationId)
  if (!invitation) {
    throw new Error(`Invitation not found: ${invitationId}`)
  }

  const data = invitation.data as InvitationThingData
  if (data.status !== 'pending') {
    throw new Error(`Invitation is not pending: ${data.status}`)
  }

  await graph.updateThing(invitationId, {
    data: { ...data, status: 'cancelled' },
  })
}

// ============================================================================
// ORGANIZATION OWNERSHIP (BELONGS_TO)
// ============================================================================

/**
 * Set organization owner
 */
export async function setOrgOwner(
  graph: GraphStore,
  orgId: string,
  userId: string
): Promise<void> {
  // Verify org exists
  const org = await getOrg(graph, orgId)
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`)
  }

  // Remove existing owner relationship
  const existingOwners = await graph.queryRelationshipsTo(orgId, { verb: HUMAN_VERBS.OWNS })
  for (const rel of existingOwners) {
    await graph.deleteRelationship(rel.id)
  }

  // Create new owner relationship
  await graph.createRelationship({
    id: `${userId}-${HUMAN_VERBS.OWNS}-${orgId}`,
    verb: HUMAN_VERBS.OWNS,
    from: userId,
    to: orgId,
    data: { assignedAt: Date.now() },
  })

  // Ensure user is a member with owner role
  const isMemberAlready = await isMember(graph, userId, orgId)
  if (isMemberAlready) {
    await updateMember(graph, userId, orgId, { role: 'owner' })
  } else {
    await addMember(graph, userId, orgId, { role: 'owner' })
  }
}

/**
 * Get organization owner
 */
export async function getOrgOwner(graph: GraphStore, orgId: string): Promise<GraphThing | null> {
  const ownerRels = await graph.queryRelationshipsTo(orgId, { verb: HUMAN_VERBS.OWNS })
  if (ownerRels.length === 0) {
    return null
  }

  return graph.getThing(ownerRels[0]!.from)
}

// ============================================================================
// ORGANIZATION STATISTICS
// ============================================================================

/**
 * Get organization statistics
 */
export async function getOrgStats(
  graph: GraphStore,
  orgId: string
): Promise<{
  memberCount: number
  adminCount: number
  ownerCount: number
  pendingInvitations: number
} | null> {
  const org = await getOrg(graph, orgId)
  if (!org) return null

  const members = await getOrgMembers(graph, orgId)
  const pendingInvitations = await getPendingInvitations(graph, orgId)

  let adminCount = 0
  let ownerCount = 0

  for (const { membership } of members) {
    if (membership.role === 'admin') adminCount++
    if (membership.role === 'owner') ownerCount++
  }

  return {
    memberCount: members.length,
    adminCount,
    ownerCount,
    pendingInvitations: pendingInvitations.length,
  }
}
