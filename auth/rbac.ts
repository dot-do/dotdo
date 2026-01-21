/**
 * Role-Based Access Control (RBAC) for @dotdo/auth
 *
 * Provides a comprehensive RBAC system with:
 * - Predefined role definitions
 * - Resource-based permission checking
 * - Policy engine for fine-grained access control
 * - Tenant isolation
 *
 * @module @dotdo/auth/rbac
 */
import type { MiddlewareHandler, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AuthUser } from './middleware'

// ============================================================================
// Types
// ============================================================================

/**
 * Built-in roles with predefined permission sets
 */
export type BuiltInRole =
  | 'super_admin'  // Full system access
  | 'admin'        // Organization admin
  | 'owner'        // Resource owner
  | 'editor'       // Can create/update resources
  | 'viewer'       // Read-only access
  | 'guest'        // Limited public access
  | 'api'          // API/service account access

/**
 * Permission actions
 */
export type PermissionAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'execute'
  | 'manage'  // Full CRUD + admin actions
  | '*'       // All actions

/**
 * Resource types in dotdo
 */
export type ResourceType =
  | 'thing'
  | 'relationship'
  | 'event'
  | 'action'
  | 'workflow'
  | 'function'
  | 'integration'
  | 'connection'
  | 'org'
  | 'user'
  | 'apikey'
  | 'analytics'
  | '*'  // All resources

/**
 * Permission definition
 */
export interface Permission {
  /** Resource type (e.g., 'thing', 'user', '*') */
  resource: ResourceType | string
  /** Action (e.g., 'read', 'create', '*') */
  action: PermissionAction | string
  /** Optional conditions for the permission */
  conditions?: PermissionCondition[]
}

/**
 * Condition for conditional permissions
 */
export interface PermissionCondition {
  /** Field to check (e.g., 'ownerId', 'tenantId', '$type') */
  field: string
  /** Operator for comparison */
  operator: 'eq' | 'ne' | 'in' | 'nin' | 'exists' | 'match'
  /** Value to compare against (can reference context with $user.id, $tenant.id) */
  value: string | string[] | boolean
}

/**
 * Role definition with permissions
 */
export interface RoleDefinition {
  /** Role name */
  name: string
  /** Human-readable description */
  description: string
  /** Permissions granted to this role */
  permissions: Permission[]
  /** Parent roles to inherit from */
  inherits?: string[]
  /** Whether this is a system role (cannot be modified) */
  system?: boolean
}

/**
 * Policy decision result
 */
export interface PolicyDecision {
  /** Whether access is allowed */
  allowed: boolean
  /** Reason for the decision */
  reason: string
  /** Matching permission (if allowed) */
  matchedPermission?: Permission
  /** Evaluated conditions */
  conditions?: { field: string; result: boolean }[]
}

/**
 * Resource context for permission checking
 */
export interface ResourceContext {
  /** Resource type */
  type: ResourceType | string
  /** Resource ID */
  id?: string
  /** Resource owner ID */
  ownerId?: string
  /** Tenant/org ID */
  tenantId?: string
  /** Additional resource attributes */
  attributes?: Record<string, unknown>
}

/**
 * User context for permission checking
 */
export interface UserContext {
  /** User ID */
  id: string
  /** User's roles */
  roles: string[]
  /** User's direct permissions (scopes) */
  permissions?: string[]
  /** User's tenant/org ID */
  tenantId?: string
  /** Additional user attributes */
  attributes?: Record<string, unknown>
}

// ============================================================================
// Built-in Role Definitions
// ============================================================================

/**
 * Default role definitions
 */
export const DEFAULT_ROLES: Record<string, RoleDefinition> = {
  super_admin: {
    name: 'super_admin',
    description: 'Full system access across all tenants',
    permissions: [
      { resource: '*', action: '*' }
    ],
    system: true
  },

  admin: {
    name: 'admin',
    description: 'Organization administrator with full access within tenant',
    permissions: [
      { resource: '*', action: '*', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] }
    ],
    system: true
  },

  owner: {
    name: 'owner',
    description: 'Resource owner with full access to owned resources',
    permissions: [
      { resource: '*', action: '*', conditions: [{ field: 'ownerId', operator: 'eq', value: '$user.id' }] }
    ],
    system: true
  },

  editor: {
    name: 'editor',
    description: 'Can create and update resources within tenant',
    permissions: [
      { resource: 'thing', action: 'create' },
      { resource: 'thing', action: 'read' },
      { resource: 'thing', action: 'update', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'thing', action: 'list' },
      { resource: 'relationship', action: 'create' },
      { resource: 'relationship', action: 'read' },
      { resource: 'relationship', action: 'update', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'relationship', action: 'list' },
      { resource: 'event', action: 'create' },
      { resource: 'event', action: 'read' },
      { resource: 'event', action: 'list' },
      { resource: 'action', action: 'execute' },
      { resource: 'workflow', action: 'execute' },
      { resource: 'function', action: 'execute' }
    ],
    system: true
  },

  viewer: {
    name: 'viewer',
    description: 'Read-only access within tenant',
    permissions: [
      { resource: 'thing', action: 'read', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'thing', action: 'list', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'relationship', action: 'read', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'relationship', action: 'list', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'event', action: 'read', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'event', action: 'list', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] },
      { resource: 'analytics', action: 'read', conditions: [{ field: 'tenantId', operator: 'eq', value: '$user.tenantId' }] }
    ],
    system: true
  },

  guest: {
    name: 'guest',
    description: 'Limited public access',
    permissions: [
      { resource: 'thing', action: 'read', conditions: [{ field: 'public', operator: 'eq', value: true }] },
      { resource: 'thing', action: 'list', conditions: [{ field: 'public', operator: 'eq', value: true }] }
    ],
    system: true
  },

  api: {
    name: 'api',
    description: 'API/service account access',
    permissions: [
      { resource: '*', action: 'read' },
      { resource: '*', action: 'list' },
      { resource: 'thing', action: 'create' },
      { resource: 'thing', action: 'update' },
      { resource: 'event', action: 'create' },
      { resource: 'action', action: 'execute' }
    ],
    system: true
  }
}

// ============================================================================
// Policy Engine
// ============================================================================

/**
 * Policy Engine for evaluating permissions
 */
export class PolicyEngine {
  private roles: Map<string, RoleDefinition>
  private rolePermissionsCache: Map<string, Permission[]>

  constructor(customRoles: Record<string, RoleDefinition> = {}) {
    this.roles = new Map()
    this.rolePermissionsCache = new Map()

    // Load default roles
    for (const [name, role] of Object.entries(DEFAULT_ROLES)) {
      this.roles.set(name, role)
    }

    // Load custom roles (can override defaults if not system roles)
    for (const [name, role] of Object.entries(customRoles)) {
      const existing = this.roles.get(name)
      if (existing?.system && !role.system) {
        // Cannot override system roles
        continue
      }
      this.roles.set(name, role)
    }
  }

  /**
   * Get a role definition by name
   */
  getRole(name: string): RoleDefinition | undefined {
    return this.roles.get(name)
  }

  /**
   * Get all permissions for a role (including inherited)
   */
  getRolePermissions(roleName: string): Permission[] {
    // Check cache
    const cached = this.rolePermissionsCache.get(roleName)
    if (cached) {
      return cached
    }

    const role = this.roles.get(roleName)
    if (!role) {
      return []
    }

    // Collect permissions including inherited
    const permissions: Permission[] = [...role.permissions]

    if (role.inherits) {
      for (const parentRole of role.inherits) {
        const parentPermissions = this.getRolePermissions(parentRole)
        permissions.push(...parentPermissions)
      }
    }

    // Cache and return
    this.rolePermissionsCache.set(roleName, permissions)
    return permissions
  }

  /**
   * Get all permissions for a user based on their roles
   */
  getUserPermissions(user: UserContext): Permission[] {
    const permissions: Permission[] = []

    for (const role of user.roles) {
      permissions.push(...this.getRolePermissions(role))
    }

    // Add direct permissions (scopes) as permissions
    if (user.permissions) {
      for (const scope of user.permissions) {
        const [resource, action] = scope.split(':')
        if (resource && action) {
          permissions.push({ resource, action })
        }
      }
    }

    return permissions
  }

  /**
   * Check if a permission matches a resource and action
   */
  permissionMatches(
    permission: Permission,
    resource: ResourceContext,
    action: PermissionAction | string
  ): boolean {
    // Check resource match
    if (permission.resource !== '*' && permission.resource !== resource.type) {
      return false
    }

    // Check action match
    if (permission.action !== '*' && permission.action !== 'manage' && permission.action !== action) {
      return false
    }

    // 'manage' includes all CRUD actions
    if (permission.action === 'manage') {
      const manageActions = ['create', 'read', 'update', 'delete', 'list']
      if (!manageActions.includes(action)) {
        return false
      }
    }

    return true
  }

  /**
   * Evaluate a condition against resource and user context
   */
  evaluateCondition(
    condition: PermissionCondition,
    resource: ResourceContext,
    user: UserContext
  ): boolean {
    // Get the actual value from resource
    let actualValue: unknown
    if (condition.field === 'ownerId') {
      actualValue = resource.ownerId
    } else if (condition.field === 'tenantId') {
      actualValue = resource.tenantId
    } else if (condition.field.startsWith('attributes.')) {
      const attrKey = condition.field.slice('attributes.'.length)
      actualValue = resource.attributes?.[attrKey]
    } else {
      actualValue = resource.attributes?.[condition.field]
    }

    // Resolve condition value (may reference user context)
    let expectedValue: unknown = condition.value
    if (typeof expectedValue === 'string') {
      if (expectedValue === '$user.id') {
        expectedValue = user.id
      } else if (expectedValue === '$user.tenantId') {
        expectedValue = user.tenantId
      } else if (expectedValue.startsWith('$user.attributes.')) {
        const attrKey = expectedValue.slice('$user.attributes.'.length)
        expectedValue = user.attributes?.[attrKey]
      }
    }

    // Evaluate based on operator
    switch (condition.operator) {
      case 'eq':
        return actualValue === expectedValue

      case 'ne':
        return actualValue !== expectedValue

      case 'in':
        if (!Array.isArray(expectedValue)) {
          return false
        }
        return expectedValue.includes(actualValue as string)

      case 'nin':
        if (!Array.isArray(expectedValue)) {
          return true
        }
        return !expectedValue.includes(actualValue as string)

      case 'exists':
        return expectedValue ? actualValue !== undefined && actualValue !== null : actualValue === undefined || actualValue === null

      case 'match':
        if (typeof actualValue !== 'string' || typeof expectedValue !== 'string') {
          return false
        }
        try {
          return new RegExp(expectedValue).test(actualValue)
        } catch {
          return false
        }

      default:
        return false
    }
  }

  /**
   * Check if a user can perform an action on a resource
   */
  check(
    user: UserContext,
    action: PermissionAction | string,
    resource: ResourceContext
  ): PolicyDecision {
    const permissions = this.getUserPermissions(user)

    for (const permission of permissions) {
      // Check if permission matches resource and action
      if (!this.permissionMatches(permission, resource, action)) {
        continue
      }

      // If no conditions, permission is granted
      if (!permission.conditions || permission.conditions.length === 0) {
        return {
          allowed: true,
          reason: `Permission granted by ${permission.resource}:${permission.action}`,
          matchedPermission: permission
        }
      }

      // Evaluate all conditions (AND logic)
      const conditionResults = permission.conditions.map(condition => ({
        field: condition.field,
        result: this.evaluateCondition(condition, resource, user)
      }))

      const allConditionsMet = conditionResults.every(c => c.result)

      if (allConditionsMet) {
        return {
          allowed: true,
          reason: `Permission granted by ${permission.resource}:${permission.action} with conditions`,
          matchedPermission: permission,
          conditions: conditionResults
        }
      }
    }

    return {
      allowed: false,
      reason: `No permission found for ${action} on ${resource.type}`
    }
  }

  /**
   * Check tenant isolation - ensures user can only access resources in their tenant
   */
  checkTenantIsolation(user: UserContext, resource: ResourceContext): PolicyDecision {
    // Super admins can access any tenant
    if (user.roles.includes('super_admin')) {
      return {
        allowed: true,
        reason: 'Super admin bypasses tenant isolation'
      }
    }

    // If resource has no tenant, allow
    if (!resource.tenantId) {
      return {
        allowed: true,
        reason: 'Resource has no tenant restriction'
      }
    }

    // If user has no tenant, deny
    if (!user.tenantId) {
      return {
        allowed: false,
        reason: 'User has no tenant context'
      }
    }

    // Check tenant match
    if (user.tenantId === resource.tenantId) {
      return {
        allowed: true,
        reason: 'User tenant matches resource tenant'
      }
    }

    return {
      allowed: false,
      reason: `Tenant isolation: user tenant ${user.tenantId} cannot access resource in tenant ${resource.tenantId}`
    }
  }

  /**
   * Full authorization check including tenant isolation
   */
  authorize(
    user: UserContext,
    action: PermissionAction | string,
    resource: ResourceContext
  ): PolicyDecision {
    // First check tenant isolation
    const tenantCheck = this.checkTenantIsolation(user, resource)
    if (!tenantCheck.allowed) {
      return tenantCheck
    }

    // Then check permissions
    return this.check(user, action, resource)
  }

  /**
   * Add a custom role
   */
  addRole(role: RoleDefinition): void {
    const existing = this.roles.get(role.name)
    if (existing?.system) {
      throw new Error(`Cannot override system role: ${role.name}`)
    }
    this.roles.set(role.name, role)
    // Clear cache
    this.rolePermissionsCache.clear()
  }

  /**
   * Remove a custom role
   */
  removeRole(name: string): boolean {
    const role = this.roles.get(name)
    if (role?.system) {
      throw new Error(`Cannot remove system role: ${name}`)
    }
    const deleted = this.roles.delete(name)
    if (deleted) {
      this.rolePermissionsCache.clear()
    }
    return deleted
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Options for RBAC middleware
 */
export interface RBACMiddlewareOptions {
  /** Custom roles to add to the policy engine */
  customRoles?: Record<string, RoleDefinition>
  /** Function to extract tenant ID from request */
  getTenantId?: (c: Context) => string | undefined
  /** Whether to enforce tenant isolation (default: true) */
  enforceTenantIsolation?: boolean
  /** Default action for authorization checks */
  defaultAction?: PermissionAction
}

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    policyEngine: PolicyEngine
    userContext: UserContext
  }
}

/**
 * Create RBAC middleware that initializes the policy engine
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { authMiddleware, rbacMiddleware, requirePermission } from '@dotdo/auth'
 *
 * const app = new Hono()
 *
 * // Apply auth first, then RBAC
 * app.use('/*', authMiddleware({ secret: process.env.JWT_SECRET }))
 * app.use('/*', rbacMiddleware({
 *   getTenantId: (c) => c.req.header('X-Tenant-ID')
 * }))
 *
 * // Use permission guards
 * app.get('/things', requirePermission('thing', 'list'), (c) => {
 *   return c.json({ things: [] })
 * })
 * ```
 */
export function rbacMiddleware(options: RBACMiddlewareOptions = {}): MiddlewareHandler {
  const {
    customRoles = {},
    getTenantId,
    enforceTenantIsolation = true
  } = options

  const policyEngine = new PolicyEngine(customRoles)

  return async (c, next) => {
    // Set policy engine in context
    c.set('policyEngine', policyEngine)

    // Get user from auth middleware
    const user = c.var.user as AuthUser | undefined

    // Build user context
    const tenantId = getTenantId?.(c) ?? c.req.header('X-Tenant-ID')

    const userContext: UserContext = {
      id: user?.id ?? 'anonymous',
      roles: user?.roles ?? ['guest'],
      permissions: user?.scopes,
      tenantId,
      attributes: {}
    }

    c.set('userContext', userContext)

    // Store tenant isolation preference for guards
    ;(c as Context & { enforceTenantIsolation?: boolean }).enforceTenantIsolation = enforceTenantIsolation

    return next()
  }
}

/**
 * Require a specific permission on a resource type
 *
 * @example
 * ```typescript
 * // Require 'read' permission on 'thing' resources
 * app.get('/things/:id', requirePermission('thing', 'read'), (c) => {
 *   return c.json({ thing: {} })
 * })
 *
 * // Require 'create' permission on 'thing' resources
 * app.post('/things', requirePermission('thing', 'create'), (c) => {
 *   return c.json({ created: true })
 * })
 * ```
 */
export function requirePermission(
  resource: ResourceType | string,
  action: PermissionAction | string,
  getResourceContext?: (c: Context) => ResourceContext | Promise<ResourceContext>
): MiddlewareHandler {
  return async (c, next) => {
    const policyEngine = c.var.policyEngine as PolicyEngine | undefined
    const userContext = c.var.userContext as UserContext | undefined

    if (!policyEngine || !userContext) {
      throw new HTTPException(500, {
        message: 'RBAC middleware not initialized - add rbacMiddleware first'
      })
    }

    // Build resource context
    let resourceContext: ResourceContext
    if (getResourceContext) {
      resourceContext = await getResourceContext(c)
    } else {
      // Default resource context from request
      resourceContext = {
        type: resource,
        id: c.req.param('id'),
        tenantId: c.req.header('X-Tenant-ID')
      }
    }

    // Check authorization
    const decision = policyEngine.authorize(userContext, action, resourceContext)

    if (!decision.allowed) {
      throw new HTTPException(403, {
        message: decision.reason
      })
    }

    return next()
  }
}

/**
 * Require the user to be the owner of a resource
 *
 * @example
 * ```typescript
 * app.delete('/things/:id', requireResourceOwner(async (c) => {
 *   const thing = await db.things.get(c.req.param('id'))
 *   return thing?.ownerId
 * }), (c) => {
 *   return c.json({ deleted: true })
 * })
 * ```
 */
export function requireResourceOwner(
  getOwnerId: (c: Context) => string | Promise<string | undefined> | undefined
): MiddlewareHandler {
  return async (c, next) => {
    const userContext = c.var.userContext as UserContext | undefined

    if (!userContext) {
      throw new HTTPException(500, {
        message: 'RBAC middleware not initialized - add rbacMiddleware first'
      })
    }

    // Super admins and admins bypass owner check
    if (userContext.roles.includes('super_admin') || userContext.roles.includes('admin')) {
      return next()
    }

    const ownerId = await getOwnerId(c)

    if (!ownerId) {
      throw new HTTPException(404, {
        message: 'Resource not found'
      })
    }

    if (userContext.id !== ownerId) {
      throw new HTTPException(403, {
        message: 'Access denied - not resource owner'
      })
    }

    return next()
  }
}

/**
 * Require tenant isolation (user must be in same tenant as resource)
 *
 * @example
 * ```typescript
 * app.use('/api/*', requireTenantMatch(async (c) => {
 *   const resource = await db.get(c.req.param('id'))
 *   return resource?.tenantId
 * }))
 * ```
 */
export function requireTenantMatch(
  getResourceTenantId: (c: Context) => string | Promise<string | undefined> | undefined
): MiddlewareHandler {
  return async (c, next) => {
    const policyEngine = c.var.policyEngine as PolicyEngine | undefined
    const userContext = c.var.userContext as UserContext | undefined

    if (!policyEngine || !userContext) {
      throw new HTTPException(500, {
        message: 'RBAC middleware not initialized - add rbacMiddleware first'
      })
    }

    const resourceTenantId = await getResourceTenantId(c)

    if (!resourceTenantId) {
      // No tenant restriction on resource
      return next()
    }

    const decision = policyEngine.checkTenantIsolation(userContext, {
      type: '*',
      tenantId: resourceTenantId
    })

    if (!decision.allowed) {
      throw new HTTPException(403, {
        message: decision.reason
      })
    }

    return next()
  }
}

/**
 * Create a permission string (for scopes)
 *
 * @example
 * ```typescript
 * const scope = permission('thing', 'read')  // 'thing:read'
 * const wildcard = permission('thing', '*')   // 'thing:*'
 * ```
 */
export function permission(resource: ResourceType | string, action: PermissionAction | string): string {
  return `${resource}:${action}`
}

/**
 * Parse a permission string into resource and action
 *
 * @example
 * ```typescript
 * const { resource, action } = parsePermission('thing:read')
 * // { resource: 'thing', action: 'read' }
 * ```
 */
export function parsePermission(permissionString: string): { resource: string; action: string } {
  const [resource = '*', action = '*'] = permissionString.split(':')
  return { resource, action }
}

/**
 * Check if a permission string matches a resource and action
 *
 * @example
 * ```typescript
 * matchesPermission('thing:read', 'thing', 'read')  // true
 * matchesPermission('thing:*', 'thing', 'read')     // true
 * matchesPermission('*:*', 'thing', 'read')         // true
 * matchesPermission('thing:write', 'thing', 'read') // false
 * ```
 */
export function matchesPermission(
  permissionString: string,
  resource: string,
  action: string
): boolean {
  const { resource: permResource, action: permAction } = parsePermission(permissionString)

  const resourceMatches = permResource === '*' || permResource === resource
  const actionMatches = permAction === '*' || permAction === action

  return resourceMatches && actionMatches
}

// ============================================================================
// Default Policy Engine Instance
// ============================================================================

/**
 * Default policy engine instance with built-in roles
 */
export const defaultPolicyEngine = new PolicyEngine()
