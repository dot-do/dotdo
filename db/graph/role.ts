/**
 * Role Graph Store
 *
 * CRUD operations for Role Things in the graph model, plus hasRole relationship
 * management for linking Users/Agents to Roles.
 *
 * @module db/graph/role
 * @see dotdo-n5bf2 - [GREEN] Role as Thing: Implementation
 *
 * @example
 * ```typescript
 * import { createRole, assignRole, getUserRoles, checkRolePermission } from 'db/graph/role'
 *
 * // Create a role
 * const adminRole = await createRole(graph, {
 *   name: 'admin',
 *   permissions: ['read:*', 'write:*'],
 *   description: 'Administrator',
 *   hierarchyLevel: 90,
 * })
 *
 * // Assign role to user
 * await assignRole(graph, 'user-alice', adminRole.id)
 *
 * // Check if user has permission
 * const result = await checkRolePermission(graph, 'user-alice', 'read:documents')
 * ```
 */

import type { GraphStore, GraphThing } from './types'
import type { RoleThingData, PermissionString, HierarchyLevel } from '../../types/Role'
import {
  isRoleThingData,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
  getEffectiveHierarchyLevel,
  mergePermissions,
  canAccessHierarchy,
} from '../../types/Role'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Type ID for Role things (conventional value) */
export const ROLE_TYPE_ID = 100

/** Type name for Role things */
export const ROLE_TYPE_NAME = 'Role'

/** Verb for user/agent -> role relationship */
export const HAS_ROLE_VERB = 'hasRole'

// ============================================================================
// ROLE CRUD OPERATIONS
// ============================================================================

/**
 * Create a new Role Thing.
 *
 * @param graph - GraphStore instance
 * @param data - Role data (name, permissions, description, hierarchyLevel)
 * @param id - Optional custom ID (defaults to `role-{name}`)
 * @returns The created Role Thing
 * @throws Error if role with same ID already exists
 *
 * @example
 * ```typescript
 * const role = await createRole(graph, {
 *   name: 'editor',
 *   permissions: ['read:*', 'write:documents'],
 *   description: 'Can edit documents',
 *   hierarchyLevel: 40,
 * })
 * ```
 */
export async function createRole(
  graph: GraphStore,
  data: RoleThingData,
  id?: string
): Promise<GraphThing> {
  const roleId = id ?? `role-${data.name}`

  return graph.createThing({
    id: roleId,
    typeId: ROLE_TYPE_ID,
    typeName: ROLE_TYPE_NAME,
    data,
  })
}

/**
 * Get a Role Thing by ID.
 *
 * @param graph - GraphStore instance
 * @param roleId - Role ID to retrieve
 * @returns The Role Thing or null if not found
 */
export async function getRole(graph: GraphStore, roleId: string): Promise<GraphThing | null> {
  const thing = await graph.getThing(roleId)
  if (!thing || thing.typeName !== ROLE_TYPE_NAME) {
    return null
  }
  return thing
}

/**
 * Get a Role Thing by name.
 *
 * @param graph - GraphStore instance
 * @param name - Role name to find
 * @returns The Role Thing or null if not found
 */
export async function getRoleByName(graph: GraphStore, name: string): Promise<GraphThing | null> {
  const roles = await graph.getThingsByType({
    typeName: ROLE_TYPE_NAME,
    limit: 1000,
  })

  return roles.find((r) => {
    const data = r.data as RoleThingData | null
    return data?.name === name
  }) ?? null
}

/**
 * List all Role Things.
 *
 * @param graph - GraphStore instance
 * @param options - Optional pagination
 * @returns Array of Role Things
 */
export async function listRoles(
  graph: GraphStore,
  options?: { limit?: number; offset?: number }
): Promise<GraphThing[]> {
  return graph.getThingsByType({
    typeName: ROLE_TYPE_NAME,
    limit: options?.limit ?? 100,
    offset: options?.offset ?? 0,
    orderBy: 'createdAt',
    orderDirection: 'desc',
  })
}

/**
 * Update a Role Thing's data.
 *
 * @param graph - GraphStore instance
 * @param roleId - Role ID to update
 * @param updates - Partial role data to merge
 * @returns The updated Role Thing or null if not found
 */
export async function updateRole(
  graph: GraphStore,
  roleId: string,
  updates: Partial<RoleThingData>
): Promise<GraphThing | null> {
  const existing = await getRole(graph, roleId)
  if (!existing) return null

  const existingData = (existing.data as RoleThingData) ?? {
    name: '',
    permissions: [],
    description: '',
    hierarchyLevel: 0,
  }

  const newData: RoleThingData = {
    name: updates.name ?? existingData.name,
    permissions: updates.permissions ?? existingData.permissions,
    description: updates.description ?? existingData.description,
    hierarchyLevel: updates.hierarchyLevel ?? existingData.hierarchyLevel,
  }

  return graph.updateThing(roleId, { data: newData })
}

/**
 * Delete (soft-delete) a Role Thing.
 *
 * @param graph - GraphStore instance
 * @param roleId - Role ID to delete
 * @returns The deleted Role Thing or null if not found
 */
export async function deleteRole(graph: GraphStore, roleId: string): Promise<GraphThing | null> {
  const role = await getRole(graph, roleId)
  if (!role) return null

  return graph.deleteThing(roleId)
}

// ============================================================================
// HAS_ROLE RELATIONSHIP OPERATIONS
// ============================================================================

/**
 * Assign a role to a user or agent.
 *
 * Creates a 'hasRole' relationship from the entity to the role.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param roleId - Role ID to assign
 * @param options - Optional relationship data
 * @returns The created relationship
 *
 * @example
 * ```typescript
 * // Assign admin role to user
 * await assignRole(graph, 'user-alice', 'role-admin')
 *
 * // Assign with metadata
 * await assignRole(graph, 'agent-bot', 'role-operator', {
 *   assignedBy: 'user-admin',
 *   expiresAt: Date.now() + 86400000, // 24 hours
 * })
 * ```
 */
export async function assignRole(
  graph: GraphStore,
  entityId: string,
  roleId: string,
  options?: { data?: Record<string, unknown> }
): Promise<void> {
  // Verify role exists
  const role = await getRole(graph, roleId)
  if (!role) {
    throw new Error(`Role not found: ${roleId}`)
  }

  // Verify entity exists
  const entity = await graph.getThing(entityId)
  if (!entity) {
    throw new Error(`Entity not found: ${entityId}`)
  }

  // Check if relationship already exists
  const existing = await graph.queryRelationshipsFrom(entityId, { verb: HAS_ROLE_VERB })
  const alreadyHasRole = existing.some((rel) => rel.to === roleId)
  if (alreadyHasRole) {
    // Already has this role, no-op
    return
  }

  // Create the hasRole relationship
  await graph.createRelationship({
    id: `${entityId}-${HAS_ROLE_VERB}-${roleId}-${Date.now()}`,
    verb: HAS_ROLE_VERB,
    from: entityId,
    to: roleId,
    data: options?.data,
  })
}

/**
 * Remove a role from a user or agent.
 *
 * Deletes the 'hasRole' relationship from the entity to the role.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param roleId - Role ID to remove
 * @returns true if role was removed, false if entity didn't have the role
 */
export async function removeRole(
  graph: GraphStore,
  entityId: string,
  roleId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(entityId, { verb: HAS_ROLE_VERB })
  const toRemove = relationships.find((rel) => rel.to === roleId)

  if (!toRemove) {
    return false
  }

  return graph.deleteRelationship(toRemove.id)
}

/**
 * Get all roles assigned to an entity.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @returns Array of Role Things
 */
export async function getEntityRoles(graph: GraphStore, entityId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsFrom(entityId, { verb: HAS_ROLE_VERB })

  const roles: GraphThing[] = []
  for (const rel of relationships) {
    const role = await getRole(graph, rel.to)
    if (role) {
      roles.push(role)
    }
  }

  return roles
}

/**
 * Get all entities that have a specific role.
 *
 * @param graph - GraphStore instance
 * @param roleId - Role ID
 * @returns Array of entity Things (Users/Agents)
 */
export async function getEntitiesWithRole(graph: GraphStore, roleId: string): Promise<GraphThing[]> {
  const relationships = await graph.queryRelationshipsTo(roleId, { verb: HAS_ROLE_VERB })

  const entities: GraphThing[] = []
  for (const rel of relationships) {
    const entity = await graph.getThing(rel.from)
    if (entity) {
      entities.push(entity)
    }
  }

  return entities
}

/**
 * Check if an entity has a specific role.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param roleId - Role ID to check
 * @returns true if entity has the role
 */
export async function entityHasRole(
  graph: GraphStore,
  entityId: string,
  roleId: string
): Promise<boolean> {
  const relationships = await graph.queryRelationshipsFrom(entityId, { verb: HAS_ROLE_VERB })
  return relationships.some((rel) => rel.to === roleId)
}

// ============================================================================
// ROLE-BASED PERMISSION CHECKS
// ============================================================================

/**
 * Result of a role-based permission check.
 */
export interface RolePermissionResult {
  /** Whether access is allowed */
  allowed: boolean
  /** Reason for denial (only present if allowed is false) */
  reason?: string
  /** Roles that were checked */
  checkedRoles?: string[]
  /** Effective permissions from all roles */
  effectivePermissions?: PermissionString[]
  /** Effective hierarchy level */
  effectiveHierarchyLevel?: HierarchyLevel
}

/**
 * Check if an entity has a required permission through their roles.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param requiredPermission - Permission string needed (e.g., 'read:documents')
 * @returns Permission check result
 *
 * @example
 * ```typescript
 * const result = await checkRolePermission(graph, 'user-alice', 'write:reports')
 * if (!result.allowed) {
 *   console.error(result.reason)
 * }
 * ```
 */
export async function checkRolePermission(
  graph: GraphStore,
  entityId: string,
  requiredPermission: PermissionString
): Promise<RolePermissionResult> {
  // Get entity's roles
  const roles = await getEntityRoles(graph, entityId)

  if (roles.length === 0) {
    return {
      allowed: false,
      reason: `Entity ${entityId} has no roles assigned`,
      checkedRoles: [],
      effectivePermissions: [],
      effectiveHierarchyLevel: 0,
    }
  }

  // Extract role data
  const roleData: RoleThingData[] = roles
    .map((r) => r.data as RoleThingData | null)
    .filter(isRoleThingData)

  const checkedRoles = roleData.map((r) => r.name)
  const effectivePermissions = mergePermissions(roleData)
  const effectiveHierarchyLevel = getEffectiveHierarchyLevel(roleData)

  // Check permission
  if (hasPermission(effectivePermissions, requiredPermission)) {
    return {
      allowed: true,
      checkedRoles,
      effectivePermissions,
      effectiveHierarchyLevel,
    }
  }

  return {
    allowed: false,
    reason: `Permission denied: ${requiredPermission} not granted by roles [${checkedRoles.join(', ')}]`,
    checkedRoles,
    effectivePermissions,
    effectiveHierarchyLevel,
  }
}

/**
 * Check if an entity has all required permissions through their roles.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param requiredPermissions - Array of permission strings needed
 * @returns Permission check result
 */
export async function checkRolePermissions(
  graph: GraphStore,
  entityId: string,
  requiredPermissions: PermissionString[]
): Promise<RolePermissionResult> {
  const roles = await getEntityRoles(graph, entityId)

  if (roles.length === 0) {
    return {
      allowed: false,
      reason: `Entity ${entityId} has no roles assigned`,
      checkedRoles: [],
      effectivePermissions: [],
      effectiveHierarchyLevel: 0,
    }
  }

  const roleData: RoleThingData[] = roles
    .map((r) => r.data as RoleThingData | null)
    .filter(isRoleThingData)

  const checkedRoles = roleData.map((r) => r.name)
  const effectivePermissions = mergePermissions(roleData)
  const effectiveHierarchyLevel = getEffectiveHierarchyLevel(roleData)

  if (hasAllPermissions(effectivePermissions, requiredPermissions)) {
    return {
      allowed: true,
      checkedRoles,
      effectivePermissions,
      effectiveHierarchyLevel,
    }
  }

  const missing = requiredPermissions.filter((p) => !hasPermission(effectivePermissions, p))
  return {
    allowed: false,
    reason: `Missing permissions: [${missing.join(', ')}]`,
    checkedRoles,
    effectivePermissions,
    effectiveHierarchyLevel,
  }
}

/**
 * Check if an entity's hierarchy level meets a requirement.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @param requiredLevel - Minimum hierarchy level needed
 * @returns Permission check result
 */
export async function checkRoleHierarchy(
  graph: GraphStore,
  entityId: string,
  requiredLevel: HierarchyLevel
): Promise<RolePermissionResult> {
  const roles = await getEntityRoles(graph, entityId)

  if (roles.length === 0) {
    return {
      allowed: false,
      reason: `Entity ${entityId} has no roles assigned`,
      checkedRoles: [],
      effectivePermissions: [],
      effectiveHierarchyLevel: 0,
    }
  }

  const roleData: RoleThingData[] = roles
    .map((r) => r.data as RoleThingData | null)
    .filter(isRoleThingData)

  const checkedRoles = roleData.map((r) => r.name)
  const effectivePermissions = mergePermissions(roleData)
  const effectiveHierarchyLevel = getEffectiveHierarchyLevel(roleData)

  if (canAccessHierarchy(effectiveHierarchyLevel, requiredLevel)) {
    return {
      allowed: true,
      checkedRoles,
      effectivePermissions,
      effectiveHierarchyLevel,
    }
  }

  return {
    allowed: false,
    reason: `Hierarchy level ${effectiveHierarchyLevel} is below required level ${requiredLevel}`,
    checkedRoles,
    effectivePermissions,
    effectiveHierarchyLevel,
  }
}

/**
 * Get the effective permissions and hierarchy level for an entity.
 *
 * @param graph - GraphStore instance
 * @param entityId - User or Agent ID
 * @returns Aggregated permissions and hierarchy from all roles
 */
export async function getEffectiveRoleAccess(
  graph: GraphStore,
  entityId: string
): Promise<{
  permissions: PermissionString[]
  hierarchyLevel: HierarchyLevel
  roles: string[]
}> {
  const roles = await getEntityRoles(graph, entityId)

  const roleData: RoleThingData[] = roles
    .map((r) => r.data as RoleThingData | null)
    .filter(isRoleThingData)

  return {
    permissions: mergePermissions(roleData),
    hierarchyLevel: getEffectiveHierarchyLevel(roleData),
    roles: roleData.map((r) => r.name),
  }
}
