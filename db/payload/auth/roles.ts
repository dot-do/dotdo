/**
 * Role Mapping Module
 *
 * Maps Better Auth roles to Payload CMS access control.
 * Provides functions for:
 * - Role to access level mapping
 * - Organization-aware role resolution
 * - Access level generation for CRUD operations
 * - Payload-compatible access control factory
 *
 * @module @dotdo/payload/auth/roles
 */

import type {
  BetterAuthRole,
  PayloadAccessLevel,
  RoleMapping,
  BetterAuthUser,
} from './types'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Access permission for a single operation.
 */
export interface AccessPermission {
  /** Whether the operation is allowed */
  allowed: boolean
  /** Optional condition for row-level access (e.g., "own records only") */
  condition?: Record<string, unknown>
}

/**
 * Access levels for CRUD operations.
 */
export interface AccessLevels {
  create: AccessPermission
  read: AccessPermission
  update: AccessPermission
  delete: AccessPermission
}

/**
 * Organization role information from session.
 */
export interface OrganizationRole {
  organizationId: string
  role: 'member' | 'admin' | 'owner'
}

/**
 * User context for access control evaluation.
 * Combines Better Auth user with organization context.
 */
export interface UserContext {
  user: BetterAuthUser
  activeOrganizationId?: string | null
  organizationRole?: OrganizationRole | null
}

/**
 * Collection-specific access configuration.
 */
export interface CollectionAccessConfig {
  /** Minimum role required for any access */
  minRole?: BetterAuthRole
  /** Roles that can create documents */
  create?: BetterAuthRole[]
  /** Roles that can read documents */
  read?: BetterAuthRole[]
  /** Roles that can update documents */
  update?: BetterAuthRole[]
  /** Roles that can delete documents */
  delete?: BetterAuthRole[]
  /** Whether users can only access their own documents */
  ownRecordsOnly?: boolean
  /** Field that contains the owner user ID */
  ownerField?: string
  /** Completely restricted (no access except owner role) */
  restricted?: boolean
}

/**
 * Extended PayloadUser with role information.
 */
export interface PayloadUserWithRole {
  id: string
  email?: string
  collection: string
  role?: BetterAuthRole | null
  accessLevel?: PayloadAccessLevel
  activeOrganizationId?: string | null
  organizationRole?: OrganizationRole | null
}

/**
 * Payload access control function signature.
 * Matches Payload CMS's expected access control interface.
 */
export type PayloadAccessFunction = (args: {
  req: { user?: PayloadUserWithRole }
}) => boolean | Promise<boolean>

/**
 * Payload access control object for a collection.
 */
export interface PayloadAccessControl {
  create: PayloadAccessFunction
  read: PayloadAccessFunction
  update: PayloadAccessFunction
  delete: PayloadAccessFunction
}

/**
 * Configuration for createAccessControl.
 */
export interface CreateAccessControlConfig {
  /** Default role mapping */
  roleMapping?: RoleMapping
  /** Collection-specific access configurations */
  collections?: Record<string, CollectionAccessConfig>
  /** Default access for unknown collections */
  defaultAccess?: CollectionAccessConfig
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default role mapping from Better Auth roles to Payload access levels.
 */
const DEFAULT_ROLE_MAPPING: RoleMapping = {
  user: 'viewer',
  admin: 'editor',
  owner: 'admin',
}

/**
 * Role hierarchy: higher index = more permissions.
 */
const ROLE_HIERARCHY: Record<BetterAuthRole, number> = {
  user: 0,
  admin: 1,
  owner: 2,
}

// ============================================================================
// Role Mapping Functions
// ============================================================================

/**
 * Maps a Better Auth role to a Payload access level.
 *
 * @param role - The Better Auth role to map
 * @param roleMapping - Optional custom role mapping
 * @returns The corresponding Payload access level
 */
export function mapRoleToAccess(
  role: BetterAuthRole | null,
  roleMapping?: RoleMapping
): PayloadAccessLevel {
  const mapping = { ...DEFAULT_ROLE_MAPPING, ...roleMapping }

  // For null role, use 'user' mapping as default
  if (!role) {
    return mapping.user
  }

  return mapping[role] ?? mapping.user
}

/**
 * Gets the effective role for a user, considering organization context.
 *
 * Priority:
 * 1. Organization role (if activeOrganizationId matches)
 * 2. User's base role
 *
 * @param context - User context with organization information
 * @returns The effective role for access control
 */
export function getEffectiveRole(context: UserContext): BetterAuthRole | null {
  const { user, activeOrganizationId, organizationRole } = context

  // Use org role if activeOrganizationId is set and matches
  if (
    activeOrganizationId &&
    organizationRole &&
    organizationRole.organizationId === activeOrganizationId
  ) {
    return normalizeOrgRole(organizationRole.role)
  }

  // Fall back to user's base role
  return user.role
}

/**
 * Normalizes organization roles to Better Auth roles.
 * Maps 'member' to 'user' since they're equivalent.
 */
function normalizeOrgRole(
  orgRole: 'member' | 'admin' | 'owner'
): BetterAuthRole {
  if (orgRole === 'member') return 'user'
  return orgRole
}

/**
 * Checks if a role meets the minimum role requirement.
 */
function meetsMinRole(
  role: BetterAuthRole | null,
  minRole: BetterAuthRole
): boolean {
  if (!role) return false
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole]
}

/**
 * Checks if a role is in a list of allowed roles.
 */
function isRoleAllowed(
  role: BetterAuthRole | null,
  allowedRoles: BetterAuthRole[]
): boolean {
  if (!role) return false
  return allowedRoles.includes(role)
}

// ============================================================================
// Access Level Generation
// ============================================================================

/**
 * Generates access levels for a role.
 *
 * Default permissions:
 * - owner: all operations
 * - admin: create, read, update, delete
 * - user: create, read (no update, no delete)
 * - null: no access
 *
 * @param role - The role to generate access for
 * @param config - Optional collection-specific configuration
 * @returns Access levels for CRUD operations
 */
export function generateAccessLevels(
  role: BetterAuthRole | null,
  config?: CollectionAccessConfig
): AccessLevels {
  // No role = no access
  if (!role) {
    return {
      create: { allowed: false },
      read: { allowed: false },
      update: { allowed: false },
      delete: { allowed: false },
    }
  }

  // Owner bypasses all restrictions
  if (role === 'owner') {
    return {
      create: { allowed: true },
      read: { allowed: true },
      update: { allowed: true },
      delete: { allowed: true },
    }
  }

  // Restricted collections deny all non-owner access
  if (config?.restricted) {
    return {
      create: { allowed: false },
      read: { allowed: false },
      update: { allowed: false },
      delete: { allowed: false },
    }
  }

  // Check minRole requirement
  if (config?.minRole && !meetsMinRole(role, config.minRole)) {
    return {
      create: { allowed: false },
      read: { allowed: false },
      update: { allowed: false },
      delete: { allowed: false },
    }
  }

  // Generate access based on config or defaults
  const createAllowed = config?.create
    ? isRoleAllowed(role, config.create)
    : true // default: user can create
  const readAllowed = config?.read ? isRoleAllowed(role, config.read) : true // default: user can read
  const updateAllowed = config?.update
    ? isRoleAllowed(role, config.update)
    : role === 'admin' // default: admin+ can update
  const deleteAllowed = config?.delete
    ? isRoleAllowed(role, config.delete)
    : role === 'admin' // default: admin+ can delete

  // Build access levels
  const access: AccessLevels = {
    create: { allowed: createAllowed },
    read: { allowed: readAllowed },
    update: { allowed: updateAllowed },
    delete: { allowed: deleteAllowed },
  }

  // Apply ownRecordsOnly conditions for user role
  // When ownRecordsOnly is set, users can update their own records
  if (config?.ownRecordsOnly && role === 'user') {
    const ownerField = config.ownerField ?? 'createdBy'
    const condition = { [ownerField]: { equals: 'user.id' } }

    // Apply condition to read
    if (access.read.allowed) {
      access.read.condition = condition
    }

    // ownRecordsOnly grants update permission with condition
    access.update.allowed = true
    access.update.condition = condition

    // Apply condition to delete if allowed
    if (access.delete.allowed) {
      access.delete.condition = condition
    }
  }

  return access
}

// ============================================================================
// Payload Access Control Factory
// ============================================================================

/**
 * Creates Payload-compatible access control for a collection.
 *
 * @param collectionSlug - The collection to create access control for
 * @param config - Optional access control configuration
 * @returns Payload access control object with CRUD functions
 */
export function createAccessControl(
  collectionSlug: string,
  config?: CreateAccessControlConfig
): PayloadAccessControl {
  const collectionConfig =
    config?.collections?.[collectionSlug] ?? config?.defaultAccess ?? {}

  const makeAccessFn = (
    operation: 'create' | 'read' | 'update' | 'delete'
  ): PayloadAccessFunction => {
    return ({ req }): boolean => {
      const user = req.user
      if (!user) return false

      // Get effective role (considering org context)
      const effectiveRole = getEffectiveRoleFromPayloadUser(user)

      // Generate access levels for this role and collection
      const accessLevels = generateAccessLevels(effectiveRole, collectionConfig)

      return accessLevels[operation].allowed
    }
  }

  return {
    create: makeAccessFn('create'),
    read: makeAccessFn('read'),
    update: makeAccessFn('update'),
    delete: makeAccessFn('delete'),
  }
}

/**
 * Gets the effective role from a PayloadUserWithRole.
 * Considers organization context if present.
 */
function getEffectiveRoleFromPayloadUser(
  user: PayloadUserWithRole
): BetterAuthRole | null {
  // Use org role if activeOrganizationId is set and matches
  if (
    user.activeOrganizationId &&
    user.organizationRole &&
    user.organizationRole.organizationId === user.activeOrganizationId
  ) {
    return normalizeOrgRole(user.organizationRole.role)
  }

  // Fall back to user's base role
  return user.role ?? null
}
