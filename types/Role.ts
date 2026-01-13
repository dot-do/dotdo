/**
 * Role Thing Type Definitions
 *
 * Roles are Things in the graph model that define permissions and hierarchy levels.
 * Users and Agents link to Roles via 'hasRole' relationships, enabling role-based
 * access control (RBAC) throughout the system.
 *
 * @module types/Role
 * @see dotdo-n5bf2 - [GREEN] Role as Thing: Implementation
 *
 * @example
 * ```typescript
 * // Create a role
 * const adminRole: RoleThingData = {
 *   name: 'admin',
 *   permissions: ['read:*', 'write:*', 'delete:*'],
 *   description: 'Full administrative access',
 *   hierarchyLevel: 100,
 * }
 *
 * // Role with limited permissions
 * const viewerRole: RoleThingData = {
 *   name: 'viewer',
 *   permissions: ['read:documents', 'read:reports'],
 *   description: 'Read-only access to documents and reports',
 *   hierarchyLevel: 10,
 * }
 * ```
 */

// ============================================================================
// ROLE TYPES
// ============================================================================

/**
 * Permission string format.
 *
 * Permissions follow the pattern: `action:resource` or `action:*` for wildcards.
 *
 * Examples:
 * - `read:documents` - Can read documents
 * - `write:customers` - Can create/update customers
 * - `delete:orders` - Can delete orders
 * - `admin:*` - Full admin access to all resources
 * - `*:*` - Superuser access (all actions on all resources)
 *
 * Actions:
 * - `read` - View/list resources
 * - `write` - Create/update resources
 * - `delete` - Remove resources
 * - `execute` - Run actions/workflows
 * - `admin` - Administrative operations
 */
export type PermissionString = string

/**
 * Role hierarchy level.
 *
 * Higher numbers indicate more privileged roles.
 * Used for inheritance and escalation checks:
 * - A user with hierarchyLevel 50 can access roles with level <= 50
 * - Inheritance flows downward: level 100 inherits from level 50, 10, etc.
 *
 * Recommended levels:
 * - 0-10: Guest/anonymous
 * - 10-30: Basic users
 * - 30-50: Power users
 * - 50-70: Team leads/managers
 * - 70-90: Admins
 * - 90-100: Super admins/owners
 */
export type HierarchyLevel = number

/**
 * Data stored in a Role Thing.
 *
 * This is the data payload that goes into the `data` field of a GraphThing
 * when the typeName is 'Role'.
 */
export interface RoleThingData {
  /**
   * Unique name identifier for the role (e.g., 'admin', 'editor', 'viewer').
   * Should be lowercase, alphanumeric with optional hyphens/underscores.
   */
  name: string

  /**
   * Array of permission strings this role grants.
   * Follows the `action:resource` pattern with wildcard support.
   *
   * @example ['read:documents', 'write:documents', 'read:reports']
   */
  permissions: PermissionString[]

  /**
   * Human-readable description of the role's purpose.
   */
  description: string

  /**
   * Numeric hierarchy level (0-100) indicating privilege level.
   * Higher numbers = more privileges.
   *
   * @default 0
   */
  hierarchyLevel: HierarchyLevel
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if data conforms to RoleThingData interface.
 */
export function isRoleThingData(data: unknown): data is RoleThingData {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.name === 'string' &&
    Array.isArray(d.permissions) &&
    d.permissions.every((p: unknown) => typeof p === 'string') &&
    typeof d.description === 'string' &&
    typeof d.hierarchyLevel === 'number'
  )
}

// ============================================================================
// PERMISSION UTILITIES
// ============================================================================

/**
 * Parse a permission string into action and resource.
 *
 * @param permission - Permission string like 'read:documents'
 * @returns Parsed action and resource, or null if invalid format
 */
export function parsePermission(permission: PermissionString): { action: string; resource: string } | null {
  const parts = permission.split(':')
  if (parts.length !== 2) return null
  return {
    action: parts[0]!,
    resource: parts[1]!,
  }
}

/**
 * Check if a permission matches a required permission (supporting wildcards).
 *
 * @param granted - Permission the user has (e.g., 'read:*')
 * @param required - Permission needed (e.g., 'read:documents')
 * @returns true if granted covers required
 *
 * @example
 * ```typescript
 * permissionMatches('read:*', 'read:documents')     // true
 * permissionMatches('*:documents', 'read:documents') // true
 * permissionMatches('*:*', 'delete:orders')         // true
 * permissionMatches('read:reports', 'read:documents') // false
 * ```
 */
export function permissionMatches(granted: PermissionString, required: PermissionString): boolean {
  const grantedParts = parsePermission(granted)
  const requiredParts = parsePermission(required)

  if (!grantedParts || !requiredParts) return false

  const actionMatches = grantedParts.action === '*' || grantedParts.action === requiredParts.action
  const resourceMatches = grantedParts.resource === '*' || grantedParts.resource === requiredParts.resource

  return actionMatches && resourceMatches
}

/**
 * Check if a set of permissions includes a required permission.
 *
 * @param permissions - Array of granted permissions
 * @param required - Permission needed
 * @returns true if any granted permission covers the required permission
 */
export function hasPermission(permissions: PermissionString[], required: PermissionString): boolean {
  return permissions.some((granted) => permissionMatches(granted, required))
}

/**
 * Check if a set of permissions includes all required permissions.
 *
 * @param permissions - Array of granted permissions
 * @param required - Array of permissions needed
 * @returns true if all required permissions are covered
 */
export function hasAllPermissions(permissions: PermissionString[], required: PermissionString[]): boolean {
  return required.every((req) => hasPermission(permissions, req))
}

/**
 * Check if a set of permissions includes any of the required permissions.
 *
 * @param permissions - Array of granted permissions
 * @param required - Array of permissions, any one of which is sufficient
 * @returns true if any required permission is covered
 */
export function hasAnyPermission(permissions: PermissionString[], required: PermissionString[]): boolean {
  return required.some((req) => hasPermission(permissions, req))
}

// ============================================================================
// HIERARCHY UTILITIES
// ============================================================================

/**
 * Check if a user's hierarchy level allows access to a target level.
 *
 * @param userLevel - User's hierarchy level
 * @param targetLevel - Required hierarchy level
 * @returns true if user level >= target level
 */
export function canAccessHierarchy(userLevel: HierarchyLevel, targetLevel: HierarchyLevel): boolean {
  return userLevel >= targetLevel
}

/**
 * Get the effective hierarchy level from multiple roles (takes highest).
 *
 * @param roles - Array of role data
 * @returns Highest hierarchy level among roles
 */
export function getEffectiveHierarchyLevel(roles: RoleThingData[]): HierarchyLevel {
  if (roles.length === 0) return 0
  return Math.max(...roles.map((r) => r.hierarchyLevel))
}

/**
 * Merge permissions from multiple roles (union).
 *
 * @param roles - Array of role data
 * @returns Unique array of all permissions
 */
export function mergePermissions(roles: RoleThingData[]): PermissionString[] {
  const allPermissions = new Set<PermissionString>()
  for (const role of roles) {
    for (const perm of role.permissions) {
      allPermissions.add(perm)
    }
  }
  return Array.from(allPermissions)
}

// ============================================================================
// DEFAULT ROLES
// ============================================================================

/**
 * Pre-defined role configurations for common use cases.
 */
export const DEFAULT_ROLES = {
  /** Superuser with full access */
  owner: {
    name: 'owner',
    permissions: ['*:*'],
    description: 'Owner with unrestricted access to all resources',
    hierarchyLevel: 100,
  } satisfies RoleThingData,

  /** Administrative access */
  admin: {
    name: 'admin',
    permissions: ['read:*', 'write:*', 'delete:*', 'admin:*'],
    description: 'Administrator with full management capabilities',
    hierarchyLevel: 90,
  } satisfies RoleThingData,

  /** Standard user with read/write */
  member: {
    name: 'member',
    permissions: ['read:*', 'write:*'],
    description: 'Member with read and write access',
    hierarchyLevel: 50,
  } satisfies RoleThingData,

  /** Read-only access */
  viewer: {
    name: 'viewer',
    permissions: ['read:*'],
    description: 'Viewer with read-only access',
    hierarchyLevel: 20,
  } satisfies RoleThingData,

  /** Minimal guest access */
  guest: {
    name: 'guest',
    permissions: ['read:public'],
    description: 'Guest with access to public resources only',
    hierarchyLevel: 0,
  } satisfies RoleThingData,
} as const
