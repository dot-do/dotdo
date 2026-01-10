/**
 * Collection Access Control Module
 *
 * Generates Payload CMS-compatible access control functions from role-based configuration.
 * Bridges Better Auth roles and permissions to Payload's access control system.
 *
 * Features:
 * - Role-based permissions (admin, user, custom roles)
 * - Document ownership filtering (createdBy field)
 * - Organization scoping (activeOrganizationId)
 * - Field-level access restrictions
 * - Super-admin bypass capability
 *
 * @module @dotdo/payload/auth/collection-access
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * PayloadRequest type for access control functions.
 * Contains user information and request context.
 */
export interface PayloadRequest {
  user?: {
    id: string
    role?: 'admin' | 'user' | string | null
    collection: string
    activeOrganizationId?: string | null
    organizationRole?: {
      organizationId: string
      role: 'member' | 'admin' | 'owner'
    } | null
    isSuperAdmin?: boolean
  } | null
}

/**
 * Where clause operator for filtering documents.
 */
export interface WhereOperator {
  equals?: string | number | boolean
  not_equals?: string | number | boolean
  in?: (string | number)[]
  not_in?: (string | number)[]
  exists?: boolean
}

/**
 * Where clause for filtering documents.
 * Used to restrict access to specific documents.
 */
export interface Where {
  [field: string]: WhereOperator | Where | Where[] | undefined
  and?: Where[]
  or?: Where[]
}

/**
 * Access function result type.
 * Returns true for full access, false for no access, or Where for filtered access.
 */
export type AccessResult = boolean | Where

/**
 * Access function signature for Payload CMS.
 */
export type AccessFunction = (args: {
  req: PayloadRequest
  id?: string
  data?: Record<string, unknown>
}) => AccessResult | Promise<AccessResult>

/**
 * Generated access control object for a collection.
 */
export interface CollectionAccessFunctions {
  create: AccessFunction
  read: AccessFunction
  update: AccessFunction
  delete: AccessFunction
}

/**
 * Permission level for an operation.
 * - true: Full access
 * - false: No access
 * - 'own': Access to own documents only (createdBy match)
 * - 'org': Access to documents in same organization
 */
export type PermissionLevel = boolean | 'own' | 'org'

/**
 * Role-based permission configuration.
 */
export interface RolePermissions {
  create?: PermissionLevel
  read?: PermissionLevel
  update?: PermissionLevel
  delete?: PermissionLevel
}

/**
 * Field-level access configuration.
 */
export interface FieldAccess {
  /** Roles that can read this field */
  read?: string[]
  /** Roles that can update this field */
  update?: string[]
  /** Hide field entirely from non-allowed roles */
  hidden?: boolean
}

/**
 * Collection access configuration.
 */
export interface CollectionAccessConfig {
  /** Collection slug */
  collection: string
  /** Role-based permissions */
  roles?: Record<string, RolePermissions>
  /** Field-level access restrictions */
  fields?: Record<string, FieldAccess>
  /** Field that identifies document owner (default: 'createdBy') */
  ownerField?: string
  /** Field that identifies document organization (default: 'organizationId') */
  orgField?: string
  /** Allow super-admins to bypass all restrictions */
  superAdminBypass?: boolean
  /** Custom access function that overrides role-based logic */
  customAccess?: AccessFunction
}

/**
 * Result from generateAccessFunctions.
 */
export interface GeneratedAccessFunctions extends CollectionAccessFunctions {
  /** Field-level access functions */
  fields?: Record<
    string,
    {
      read: AccessFunction
      update: AccessFunction
    }
  >
}

/**
 * Context for permission checking.
 */
export interface PermissionContext {
  ownerField?: string
  orgField?: string
  documentOwnerId?: string
  documentOrgId?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if user has a specific permission level.
 * Returns true, false, or a Where filter for filtered access.
 *
 * @param user - The user from the request
 * @param permission - The permission level to check
 * @param context - Optional context with custom field names
 * @returns boolean or Where filter
 */
export function checkPermission(
  user: PayloadRequest['user'],
  permission: PermissionLevel,
  context: PermissionContext = {}
): boolean | Where {
  const { ownerField = 'createdBy', orgField = 'organizationId' } = context

  if (permission === true) return true
  if (permission === false) return false

  if (!user) return false

  if (permission === 'own') {
    return { [ownerField]: { equals: user.id } }
  }

  if (permission === 'org') {
    if (!user.activeOrganizationId) return false
    return { [orgField]: { equals: user.activeOrganizationId } }
  }

  return false
}

/**
 * Creates a combined filter for 'own' permission when user has an active organization.
 * Combines owner filter with org filter using AND.
 */
function createOwnWithOrgFilter(
  user: NonNullable<PayloadRequest['user']>,
  ownerField: string,
  orgField: string
): Where {
  if (user.activeOrganizationId) {
    return {
      and: [
        { [ownerField]: { equals: user.id } },
        { [orgField]: { equals: user.activeOrganizationId } },
      ],
    }
  }
  return { [ownerField]: { equals: user.id } }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Creates Payload-compatible access control functions for a collection.
 *
 * @param config - Collection access configuration
 * @returns Object with create, read, update, delete access functions
 */
export function createCollectionAccess(
  config: CollectionAccessConfig
): CollectionAccessFunctions {
  const {
    roles = {},
    ownerField = 'createdBy',
    orgField = 'organizationId',
    superAdminBypass = false,
    customAccess,
  } = config

  /**
   * Helper to create an access function for a specific operation.
   */
  const makeAccessFunction = (
    operation: 'create' | 'read' | 'update' | 'delete'
  ): AccessFunction => {
    return async (args) => {
      const { req, id, data } = args

      // If custom access is defined, use it for all operations
      if (customAccess) {
        return customAccess(args)
      }

      // No user = no access
      if (!req.user) return false

      // Super-admin bypass
      if (superAdminBypass && req.user.isSuperAdmin) {
        return true
      }

      // Get role and check if it exists in config
      const userRole = req.user.role
      if (!userRole) return false

      const roleConfig = roles[userRole]
      if (!roleConfig) return false

      // Get permission for this operation
      const permission = roleConfig[operation]
      if (permission === undefined) return false

      // For create operations, only boolean makes sense
      if (operation === 'create') {
        return permission === true
      }

      // For 'own' permission with active org, combine filters
      if (permission === 'own' && req.user.activeOrganizationId) {
        return createOwnWithOrgFilter(req.user, ownerField, orgField)
      }

      // Standard permission check
      return checkPermission(req.user, permission, { ownerField, orgField })
    }
  }

  return {
    create: makeAccessFunction('create'),
    read: makeAccessFunction('read'),
    update: makeAccessFunction('update'),
    delete: makeAccessFunction('delete'),
  }
}

/**
 * Generates access functions with field-level controls.
 *
 * @param config - Collection access configuration with optional field definitions
 * @returns Object with CRUD access functions and optional field-level access functions
 */
export function generateAccessFunctions(
  config: CollectionAccessConfig
): GeneratedAccessFunctions {
  // Get base collection-level access functions
  const baseAccess = createCollectionAccess(config)

  const result: GeneratedAccessFunctions = {
    ...baseAccess,
  }

  // Generate field-level access if fields are configured
  if (config.fields) {
    result.fields = {}

    for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
      result.fields[fieldName] = {
        read: createFieldAccessFunction(fieldConfig.read || [], fieldConfig.hidden),
        update: createFieldAccessFunction(fieldConfig.update || []),
      }
    }
  }

  return result
}

/**
 * Creates a field-level access function.
 *
 * @param allowedRoles - Array of roles that can access this field
 * @param hidden - If true and role not allowed, field is hidden
 * @returns Access function that returns boolean
 */
function createFieldAccessFunction(
  allowedRoles: string[],
  hidden?: boolean
): AccessFunction {
  return async ({ req }) => {
    if (!req.user) return false

    const userRole = req.user.role
    if (!userRole) return false

    // If no roles specified and field is hidden, deny all
    if (allowedRoles.length === 0) return false

    // Check if user's role is in allowed roles
    return allowedRoles.includes(userRole)
  }
}
