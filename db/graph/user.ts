/**
 * User Graph Store
 *
 * CRUD operations for User Things in the graph model, plus relationship
 * management for linking Users to Roles, Organizations, and other entities.
 *
 * @module db/graph/user
 * @see dotdo-g5upr - [GREEN] User as Thing: Implementation
 *
 * @example
 * ```typescript
 * import { createUser, getUserRoles, addUserToOrg, getUserProfile } from 'db/graph/user'
 *
 * // Create a user
 * const user = await createUser(graph, {
 *   email: 'alice@example.com',
 *   name: 'Alice',
 *   displayName: 'Alice Smith',
 *   status: 'active',
 * })
 *
 * // Assign role to user
 * await assignUserRole(graph, user.id, 'role-admin')
 *
 * // Add user to organization
 * await addUserToOrg(graph, user.id, 'org-acme', { role: 'member' })
 * ```
 */

import type { GraphStore, GraphThing } from './types'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for User things (conventional value) */
export const USER_TYPE_ID = 10

/** Type name for User things */
export const USER_TYPE_NAME = 'User'

/** Verbs for user relationships */
export const USER_VERBS = {
  /** User has a role */
  HAS_ROLE: 'hasRole',
  /** User is member of organization */
  MEMBER_OF: 'memberOf',
  /** User owns a resource */
  OWNS: 'owns',
  /** User follows another user */
  FOLLOWS: 'follows',
  /** User belongs to a team */
  BELONGS_TO: 'belongsTo',
  /** User manages another entity */
  MANAGES: 'manages',
  /** User created a resource */
  CREATED: 'created',
} as const

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * User status enum
 */
export type UserStatus = 'active' | 'inactive' | 'suspended' | 'pending' | 'deleted'

/**
 * User Thing data structure
 *
 * Note: Index signature allows compatibility with GraphStore's Record<string, unknown>
 */
export interface UserThingData {
  /** Primary email address (unique identifier) */
  email: string
  /** Display name */
  name?: string | null
  /** Full display name */
  displayName?: string | null
  /** First name */
  firstName?: string | null
  /** Last name */
  lastName?: string | null
  /** User status */
  status: UserStatus
  /** Email verified flag */
  emailVerified?: boolean
  /** Profile image URL */
  avatarUrl?: string | null
  /** User bio/description */
  bio?: string | null
  /** Timezone (IANA format) */
  timezone?: string | null
  /** Locale (e.g., 'en-US') */
  locale?: string | null
  /** Phone number */
  phone?: string | null
  /** Phone verified flag */
  phoneVerified?: boolean
  /** External provider ID (for OAuth) */
  externalId?: string | null
  /** External provider name */
  externalProvider?: string | null
  /** Last sign-in timestamp (ms) */
  lastSignInAt?: number | null
  /** Last active timestamp (ms) */
  lastActiveAt?: number | null
  /** Custom metadata */
  metadata?: Record<string, unknown>
  /** Profile data (extended user info) */
  profile?: UserProfileData
  /** Index signature for GraphStore compatibility */
  [key: string]: unknown
}

/**
 * Extended profile data for User
 */
export interface UserProfileData {
  /** Job title */
  title?: string | null
  /** Company/organization */
  company?: string | null
  /** Location */
  location?: string | null
  /** Website URL */
  website?: string | null
  /** Social links */
  social?: {
    twitter?: string | null
    github?: string | null
    linkedin?: string | null
    [key: string]: string | null | undefined
  }
  /** Custom profile fields */
  customFields?: Record<string, unknown>
}

/**
 * Options for creating a user
 */
export interface CreateUserOptions {
  /** Custom user ID (defaults to generated) */
  id?: string
  /** Skip email uniqueness check */
  skipEmailCheck?: boolean
}

/**
 * Options for updating a user
 */
export interface UpdateUserOptions {
  /** Merge metadata instead of replacing */
  mergeMetadata?: boolean
  /** Merge profile instead of replacing */
  mergeProfile?: boolean
}

/**
 * Options for querying users
 */
export interface QueryUsersOptions {
  /** Filter by status */
  status?: UserStatus
  /** Filter by email verification */
  emailVerified?: boolean
  /** Maximum results */
  limit?: number
  /** Offset for pagination */
  offset?: number
  /** Order by field */
  orderBy?: 'createdAt' | 'updatedAt' | 'lastSignInAt' | 'lastActiveAt' | 'email' | 'name'
  /** Order direction */
  orderDirection?: 'asc' | 'desc'
}

/**
 * Organization membership data
 */
export interface OrgMembershipData {
  /** Role within the organization */
  role?: string
  /** Joined timestamp */
  joinedAt?: number
  /** Invited by user ID */
  invitedBy?: string
  /** Custom membership metadata */
  metadata?: Record<string, unknown>
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if data is UserThingData
 */
export function isUserThingData(data: unknown): data is UserThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.email === 'string' && typeof d.status === 'string'
}

/**
 * Validate email format (basic validation)
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// ============================================================================
// USER CRUD OPERATIONS
// ============================================================================

/**
 * Create a new User Thing.
 *
 * @param graph - GraphStore instance
 * @param data - User data (email, name, status, etc.)
 * @param options - Optional creation options
 * @returns The created User Thing
 * @throws Error if user with same ID/email already exists
 *
 * @example
 * ```typescript
 * const user = await createUser(graph, {
 *   email: 'alice@example.com',
 *   name: 'Alice',
 *   status: 'active',
 * })
 * ```
 */
export async function createUser(
  graph: GraphStore,
  data: UserThingData,
  options?: CreateUserOptions
): Promise<GraphThing> {
  // Validate email
  if (!isValidEmail(data.email)) {
    throw new Error(`Invalid email format: ${data.email}`)
  }

  // Check for duplicate email (unless skipped)
  if (!options?.skipEmailCheck) {
    const existing = await getUserByEmail(graph, data.email)
    if (existing) {
      throw new Error(`User with email '${data.email}' already exists`)
    }
  }

  const userId = options?.id ?? `user-${crypto.randomUUID()}`

  // Normalize data
  const userData: UserThingData = {
    ...data,
    email: data.email.toLowerCase().trim(),
    status: data.status || 'pending',
    emailVerified: data.emailVerified ?? false,
    phoneVerified: data.phoneVerified ?? false,
  }

  return graph.createThing({
    id: userId,
    typeId: USER_TYPE_ID,
    typeName: USER_TYPE_NAME,
    data: userData,
  })
}

/**
 * Get a User Thing by ID.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID to retrieve
 * @returns The User Thing or null if not found
 */
export async function getUser(graph: GraphStore, userId: string): Promise<GraphThing | null> {
  const thing = await graph.getThing(userId)
  if (!thing || thing.typeName !== USER_TYPE_NAME || thing.deletedAt !== null) {
    return null
  }
  return thing
}

/**
 * Get a User Thing by email.
 *
 * @param graph - GraphStore instance
 * @param email - Email address to find
 * @returns The User Thing or null if not found
 */
export async function getUserByEmail(graph: GraphStore, email: string): Promise<GraphThing | null> {
  const normalizedEmail = email.toLowerCase().trim()
  const users = await graph.getThingsByType({
    typeName: USER_TYPE_NAME,
    limit: 1000,
  })

  return users.find((u) => {
    const data = u.data as UserThingData | null
    return data?.email?.toLowerCase() === normalizedEmail && u.deletedAt === null
  }) ?? null
}

/**
 * Get a User Thing by external provider ID.
 *
 * @param graph - GraphStore instance
 * @param provider - External provider name (e.g., 'google', 'github')
 * @param externalId - External provider user ID
 * @returns The User Thing or null if not found
 */
export async function getUserByExternalId(
  graph: GraphStore,
  provider: string,
  externalId: string
): Promise<GraphThing | null> {
  const users = await graph.getThingsByType({
    typeName: USER_TYPE_NAME,
    limit: 1000,
  })

  return users.find((u) => {
    const data = u.data as UserThingData | null
    return (
      data?.externalProvider === provider &&
      data?.externalId === externalId &&
      u.deletedAt === null
    )
  }) ?? null
}

/**
 * List users with optional filters.
 *
 * @param graph - GraphStore instance
 * @param options - Query options (status, limit, offset, orderBy)
 * @returns Array of User Things
 */
export async function listUsers(
  graph: GraphStore,
  options?: QueryUsersOptions
): Promise<GraphThing[]> {
  let users = await graph.getThingsByType({
    typeName: USER_TYPE_NAME,
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
    orderBy: options?.orderBy ?? 'createdAt',
    orderDirection: options?.orderDirection ?? 'desc',
  })

  // Apply filters
  if (options?.status) {
    users = users.filter((u) => {
      const data = u.data as UserThingData | null
      return data?.status === options.status
    })
  }

  if (options?.emailVerified !== undefined) {
    users = users.filter((u) => {
      const data = u.data as UserThingData | null
      return data?.emailVerified === options.emailVerified
    })
  }

  return users
}

/**
 * Update a User Thing's data.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID to update
 * @param updates - Partial user data to merge
 * @param options - Update options
 * @returns The updated User Thing or null if not found
 */
export async function updateUser(
  graph: GraphStore,
  userId: string,
  updates: Partial<UserThingData>,
  options?: UpdateUserOptions
): Promise<GraphThing | null> {
  const existing = await getUser(graph, userId)
  if (!existing) return null

  const existingData = (existing.data as UserThingData) ?? {
    email: '',
    status: 'pending' as UserStatus,
  }

  // If email is being changed, validate uniqueness
  if (updates.email && updates.email.toLowerCase() !== existingData.email.toLowerCase()) {
    if (!isValidEmail(updates.email)) {
      throw new Error(`Invalid email format: ${updates.email}`)
    }
    const duplicate = await getUserByEmail(graph, updates.email)
    if (duplicate && duplicate.id !== userId) {
      throw new Error(`User with email '${updates.email}' already exists`)
    }
  }

  // Build new data
  const newData: UserThingData = {
    ...existingData,
    ...updates,
    email: updates.email?.toLowerCase().trim() ?? existingData.email,
  }

  // Handle metadata merging
  if (updates.metadata && options?.mergeMetadata) {
    newData.metadata = { ...existingData.metadata, ...updates.metadata }
  }

  // Handle profile merging
  if (updates.profile && options?.mergeProfile) {
    newData.profile = { ...existingData.profile, ...updates.profile }
  }

  return graph.updateThing(userId, { data: newData })
}

/**
 * Update user's last active timestamp.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns The updated User Thing or null if not found
 */
export async function touchUser(graph: GraphStore, userId: string): Promise<GraphThing | null> {
  return updateUser(graph, userId, { lastActiveAt: Date.now() })
}

/**
 * Update user's last sign-in timestamp.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns The updated User Thing or null if not found
 */
export async function recordUserSignIn(graph: GraphStore, userId: string): Promise<GraphThing | null> {
  const now = Date.now()
  return updateUser(graph, userId, {
    lastSignInAt: now,
    lastActiveAt: now,
  })
}

/**
 * Delete (soft-delete) a User Thing.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID to delete
 * @returns The deleted User Thing or null if not found
 */
export async function deleteUser(graph: GraphStore, userId: string): Promise<GraphThing | null> {
  const user = await getUser(graph, userId)
  if (!user) return null

  // Update status to deleted before soft-delete
  await updateUser(graph, userId, { status: 'deleted' })

  return graph.deleteThing(userId)
}

/**
 * Suspend a user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID to suspend
 * @param reason - Optional suspension reason
 * @returns The updated User Thing or null if not found
 */
export async function suspendUser(
  graph: GraphStore,
  userId: string,
  reason?: string
): Promise<GraphThing | null> {
  return updateUser(graph, userId, {
    status: 'suspended',
    metadata: reason ? { suspendedReason: reason, suspendedAt: Date.now() } : undefined,
  }, { mergeMetadata: true })
}

/**
 * Reactivate a suspended user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID to reactivate
 * @returns The updated User Thing or null if not found
 */
export async function reactivateUser(graph: GraphStore, userId: string): Promise<GraphThing | null> {
  const user = await getUser(graph, userId)
  if (!user) return null

  const data = user.data as UserThingData | null
  if (data?.status !== 'suspended') {
    throw new Error(`User ${userId} is not suspended`)
  }

  return updateUser(graph, userId, {
    status: 'active',
    metadata: { reactivatedAt: Date.now() },
  }, { mergeMetadata: true })
}

// ============================================================================
// USER PROFILE OPERATIONS
// ============================================================================

/**
 * Get user profile data.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns User profile data or null if user not found
 */
export async function getUserProfile(
  graph: GraphStore,
  userId: string
): Promise<UserProfileData | null> {
  const user = await getUser(graph, userId)
  if (!user) return null

  const data = user.data as UserThingData | null
  return data?.profile ?? null
}

/**
 * Update user profile data.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param profile - Profile data to update
 * @returns The updated User Thing or null if not found
 */
export async function updateUserProfile(
  graph: GraphStore,
  userId: string,
  profile: Partial<UserProfileData>
): Promise<GraphThing | null> {
  return updateUser(graph, userId, { profile: profile as UserProfileData }, { mergeProfile: true })
}

// ============================================================================
// USER ROLE RELATIONSHIPS
// ============================================================================

/**
 * Assign a role to a user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param roleId - Role ID to assign
 * @param options - Optional relationship data
 * @returns void
 *
 * @example
 * ```typescript
 * await assignUserRole(graph, 'user-alice', 'role-admin', {
 *   assignedBy: 'user-admin',
 * })
 * ```
 */
export async function assignUserRole(
  graph: GraphStore,
  userId: string,
  roleId: string,
  options?: { data?: Record<string, unknown> }
): Promise<void> {
  // Verify user exists
  const user = await getUser(graph, userId)
  if (!user) {
    throw new Error(`User not found: ${userId}`)
  }

  // Verify role exists
  const role = await graph.getThing(roleId)
  if (!role || role.typeName !== 'Role' || role.deletedAt !== null) {
    throw new Error(`Role not found: ${roleId}`)
  }

  // Check if relationship already exists
  const existing = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.HAS_ROLE })
  const alreadyHasRole = existing.some((rel) => rel.to === roleId)
  if (alreadyHasRole) {
    return // Already has this role
  }

  // Create the hasRole relationship
  await graph.createRelationship({
    id: `${userId}-${USER_VERBS.HAS_ROLE}-${roleId}-${Date.now()}`,
    verb: USER_VERBS.HAS_ROLE,
    from: userId,
    to: roleId,
    data: {
      assignedAt: Date.now(),
      ...options?.data,
    },
  })
}

/**
 * Remove a role from a user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param roleId - Role ID to remove
 * @returns true if role was removed, false if user didn't have the role
 */
export async function removeUserRole(
  graph: GraphStore,
  userId: string,
  roleId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.HAS_ROLE })
  const toRemove = relationships.find((rel) => rel.to === roleId)

  if (!toRemove) {
    return false
  }

  return graph.deleteRelationship(toRemove.id)
}

/**
 * Get all roles assigned to a user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns Array of Role Things
 */
export async function getUserRoles(graph: GraphStore, userId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.HAS_ROLE })

  const roles: GraphThing[] = []
  for (const rel of relationships) {
    const role = await graph.getThing(rel.to)
    if (role && role.typeName === 'Role' && role.deletedAt === null) {
      roles.push(role)
    }
  }

  return roles
}

/**
 * Check if a user has a specific role.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param roleId - Role ID to check
 * @returns true if user has the role
 */
export async function userHasRole(
  graph: GraphStore,
  userId: string,
  roleId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.HAS_ROLE })
  return relationships.some((rel) => rel.to === roleId)
}

// ============================================================================
// USER ORGANIZATION RELATIONSHIPS (memberOf)
// ============================================================================

/**
 * Add user to an organization.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param orgId - Organization ID
 * @param membership - Membership data (role, etc.)
 * @returns void
 *
 * @example
 * ```typescript
 * await addUserToOrg(graph, 'user-alice', 'org-acme', {
 *   role: 'member',
 *   invitedBy: 'user-admin',
 * })
 * ```
 */
export async function addUserToOrg(
  graph: GraphStore,
  userId: string,
  orgId: string,
  membership?: OrgMembershipData
): Promise<void> {
  // Verify user exists
  const user = await getUser(graph, userId)
  if (!user) {
    throw new Error(`User not found: ${userId}`)
  }

  // Verify org exists
  const org = await graph.getThing(orgId)
  if (!org || org.deletedAt !== null) {
    throw new Error(`Organization not found: ${orgId}`)
  }

  // Check if already a member
  const existing = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF })
  const alreadyMember = existing.some((rel) => rel.to === orgId)
  if (alreadyMember) {
    return
  }

  // Create the memberOf relationship
  await graph.createRelationship({
    id: `${userId}-${USER_VERBS.MEMBER_OF}-${orgId}-${Date.now()}`,
    verb: USER_VERBS.MEMBER_OF,
    from: userId,
    to: orgId,
    data: {
      joinedAt: Date.now(),
      role: membership?.role ?? 'member',
      ...membership,
    },
  })
}

/**
 * Remove user from an organization.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param orgId - Organization ID
 * @returns true if removed, false if not a member
 */
export async function removeUserFromOrg(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF })
  const toRemove = relationships.find((rel) => rel.to === orgId)

  if (!toRemove) {
    return false
  }

  return graph.deleteRelationship(toRemove.id)
}

/**
 * Get all organizations a user belongs to.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns Array of organization Things with membership data
 */
export async function getUserOrganizations(
  graph: GraphStore,
  userId: string
): Promise<Array<{ org: GraphThing; membership: OrgMembershipData }>> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF })

  const results: Array<{ org: GraphThing; membership: OrgMembershipData }> = []
  for (const rel of relationships) {
    const org = await graph.getThing(rel.to)
    if (org && org.deletedAt === null) {
      results.push({
        org,
        membership: (rel.data as OrgMembershipData) ?? { role: 'member' },
      })
    }
  }

  return results
}

/**
 * Check if a user is a member of an organization.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param orgId - Organization ID
 * @returns true if user is a member
 */
export async function isUserMemberOf(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF })
  return relationships.some((rel) => rel.to === orgId)
}

/**
 * Get user's role within an organization.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @param orgId - Organization ID
 * @returns The user's role in the org or null if not a member
 */
export async function getUserOrgRole(
  graph: GraphStore,
  userId: string,
  orgId: string
): Promise<string | null> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF })
  const membership = relationships.find((rel) => rel.to === orgId)

  if (!membership) return null

  return (membership.data as OrgMembershipData)?.role ?? 'member'
}

// ============================================================================
// USER SOCIAL RELATIONSHIPS (follows)
// ============================================================================

/**
 * Make a user follow another user.
 *
 * @param graph - GraphStore instance
 * @param followerId - User ID who is following
 * @param followeeId - User ID being followed
 * @returns void
 */
export async function followUser(
  graph: GraphStore,
  followerId: string,
  followeeId: string
): Promise<void> {
  // Verify both users exist
  const follower = await getUser(graph, followerId)
  if (!follower) {
    throw new Error(`User not found: ${followerId}`)
  }

  const followee = await getUser(graph, followeeId)
  if (!followee) {
    throw new Error(`User not found: ${followeeId}`)
  }

  // Prevent self-follow
  if (followerId === followeeId) {
    throw new Error('Users cannot follow themselves')
  }

  // Check if already following
  const existing = await graph.queryRelationshipsFrom(followerId, { verb: USER_VERBS.FOLLOWS })
  const alreadyFollowing = existing.some((rel) => rel.to === followeeId)
  if (alreadyFollowing) {
    return
  }

  // Create the follows relationship
  await graph.createRelationship({
    id: `${followerId}-${USER_VERBS.FOLLOWS}-${followeeId}-${Date.now()}`,
    verb: USER_VERBS.FOLLOWS,
    from: followerId,
    to: followeeId,
    data: { followedAt: Date.now() },
  })
}

/**
 * Make a user unfollow another user.
 *
 * @param graph - GraphStore instance
 * @param followerId - User ID who is unfollowing
 * @param followeeId - User ID being unfollowed
 * @returns true if unfollowed, false if wasn't following
 */
export async function unfollowUser(
  graph: GraphStore,
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(followerId, { verb: USER_VERBS.FOLLOWS })
  const toRemove = relationships.find((rel) => rel.to === followeeId)

  if (!toRemove) {
    return false
  }

  return graph.deleteRelationship(toRemove.id)
}

/**
 * Get all users a user is following.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns Array of User Things
 */
export async function getFollowing(graph: GraphStore, userId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.FOLLOWS })

  const users: GraphThing[] = []
  for (const rel of relationships) {
    const user = await getUser(graph, rel.to)
    if (user) {
      users.push(user)
    }
  }

  return users
}

/**
 * Get all users following a user.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns Array of User Things
 */
export async function getFollowers(graph: GraphStore, userId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(userId, { verb: USER_VERBS.FOLLOWS })

  const users: GraphThing[] = []
  for (const rel of relationships) {
    const user = await getUser(graph, rel.from)
    if (user) {
      users.push(user)
    }
  }

  return users
}

/**
 * Check if a user is following another user.
 *
 * @param graph - GraphStore instance
 * @param followerId - User ID who might be following
 * @param followeeId - User ID who might be followed
 * @returns true if following
 */
export async function isFollowing(
  graph: GraphStore,
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(followerId, { verb: USER_VERBS.FOLLOWS })
  return relationships.some((rel) => rel.to === followeeId)
}

// ============================================================================
// USER STATISTICS
// ============================================================================

/**
 * Get user statistics.
 *
 * @param graph - GraphStore instance
 * @param userId - User ID
 * @returns User statistics object
 */
export async function getUserStats(
  graph: GraphStore,
  userId: string
): Promise<{
  rolesCount: number
  orgsCount: number
  followingCount: number
  followersCount: number
} | null> {
  const user = await getUser(graph, userId)
  if (!user) return null

  const [roles, memberOf, following, followers] = await Promise.all([
    graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.HAS_ROLE }),
    graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.MEMBER_OF }),
    graph.queryRelationshipsFrom(userId, { verb: USER_VERBS.FOLLOWS }),
    graph.queryRelationshipsTo(userId, { verb: USER_VERBS.FOLLOWS }),
  ])

  return {
    rolesCount: roles.length,
    orgsCount: memberOf.length,
    followingCount: following.length,
    followersCount: followers.length,
  }
}

/**
 * Get users by their organization.
 *
 * @param graph - GraphStore instance
 * @param orgId - Organization ID
 * @param options - Query options
 * @returns Array of User Things with membership data
 */
export async function getOrgUsers(
  graph: GraphStore,
  orgId: string,
  options?: { role?: string; limit?: number }
): Promise<Array<{ user: GraphThing; membership: OrgMembershipData }>> {
  const relationships = await graph.queryRelationshipsTo(orgId, { verb: USER_VERBS.MEMBER_OF })

  let results: Array<{ user: GraphThing; membership: OrgMembershipData }> = []

  for (const rel of relationships) {
    const user = await getUser(graph, rel.from)
    if (user) {
      const membership = (rel.data as OrgMembershipData) ?? { role: 'member' }

      // Filter by role if specified
      if (!options?.role || membership.role === options.role) {
        results.push({ user, membership })
      }
    }
  }

  // Apply limit
  if (options?.limit && results.length > options.limit) {
    results = results.slice(0, options.limit)
  }

  return results
}

/**
 * Get users with a specific role.
 *
 * @param graph - GraphStore instance
 * @param roleId - Role ID
 * @returns Array of User Things
 */
export async function getUsersWithRole(graph: GraphStore, roleId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(roleId, { verb: USER_VERBS.HAS_ROLE })

  const users: GraphThing[] = []
  for (const rel of relationships) {
    const user = await getUser(graph, rel.from)
    if (user) {
      users.push(user)
    }
  }

  return users
}
