import { HTTPException } from 'hono/http-exception';
// ============================================================================
// Role Hierarchy
// ============================================================================
/**
 * Role hierarchy levels (higher number = more permissions)
 * Used for role comparison and inheritance validation
 */
export const ROLE_HIERARCHY = {
    guest: 0,
    viewer: 10,
    api: 20,
    editor: 30,
    owner: 40,
    admin: 50,
    super_admin: 100,
};
/**
 * Check if role A is higher than or equal to role B in the hierarchy
 *
 * @example
 * ```typescript
 * isRoleAtLeast('admin', 'editor')   // true
 * isRoleAtLeast('viewer', 'editor')  // false
 * isRoleAtLeast('admin', 'admin')    // true
 * ```
 */
export function isRoleAtLeast(roleA, roleB) {
    const levelA = ROLE_HIERARCHY[roleA] ?? -1;
    const levelB = ROLE_HIERARCHY[roleB] ?? -1;
    return levelA >= levelB;
}
/**
 * Get the highest role from a list of roles
 *
 * @example
 * ```typescript
 * getHighestRole(['viewer', 'editor', 'guest'])  // 'editor'
 * getHighestRole(['super_admin', 'admin'])       // 'super_admin'
 * ```
 */
export function getHighestRole(roles) {
    if (roles.length === 0)
        return undefined;
    let highest;
    let highestLevel = -1;
    for (const role of roles) {
        const level = ROLE_HIERARCHY[role] ?? -1;
        if (level > highestLevel) {
            highestLevel = level;
            highest = role;
        }
    }
    return highest;
}
/**
 * Check if a user has at least the specified role level
 *
 * @example
 * ```typescript
 * const user = { id: 'u1', roles: ['editor', 'viewer'] }
 * userHasAtLeastRole(user, 'viewer')  // true
 * userHasAtLeastRole(user, 'admin')   // false
 * ```
 */
export function userHasAtLeastRole(user, requiredRole) {
    const highestUserRole = getHighestRole(user.roles);
    if (!highestUserRole)
        return false;
    return isRoleAtLeast(highestUserRole, requiredRole);
}
// ============================================================================
// Built-in Role Definitions
// ============================================================================
/**
 * Default role definitions
 */
export const DEFAULT_ROLES = {
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
};
// ============================================================================
// Policy Engine
// ============================================================================
/**
 * Policy Engine for evaluating permissions
 */
export class PolicyEngine {
    roles;
    rolePermissionsCache;
    constructor(customRoles = {}) {
        this.roles = new Map();
        this.rolePermissionsCache = new Map();
        // Load default roles
        for (const [name, role] of Object.entries(DEFAULT_ROLES)) {
            this.roles.set(name, role);
        }
        // Load custom roles (can override defaults if not system roles)
        for (const [name, role] of Object.entries(customRoles)) {
            const existing = this.roles.get(name);
            if (existing?.system && !role.system) {
                // Cannot override system roles
                continue;
            }
            this.roles.set(name, role);
        }
    }
    /**
     * Get a role definition by name
     */
    getRole(name) {
        return this.roles.get(name);
    }
    /**
     * Get all permissions for a role (including inherited)
     */
    getRolePermissions(roleName) {
        // Check cache
        const cached = this.rolePermissionsCache.get(roleName);
        if (cached) {
            return cached;
        }
        const role = this.roles.get(roleName);
        if (!role) {
            return [];
        }
        // Collect permissions including inherited
        const permissions = [...role.permissions];
        if (role.inherits) {
            for (const parentRole of role.inherits) {
                const parentPermissions = this.getRolePermissions(parentRole);
                permissions.push(...parentPermissions);
            }
        }
        // Cache and return
        this.rolePermissionsCache.set(roleName, permissions);
        return permissions;
    }
    /**
     * Get all permissions for a user based on their roles
     */
    getUserPermissions(user) {
        const permissions = [];
        for (const role of user.roles) {
            permissions.push(...this.getRolePermissions(role));
        }
        // Add direct permissions (scopes) as permissions
        if (user.permissions) {
            for (const scope of user.permissions) {
                const [resource, action] = scope.split(':');
                if (resource && action) {
                    permissions.push({ resource, action });
                }
            }
        }
        return permissions;
    }
    /**
     * Check if a permission matches a resource and action
     */
    permissionMatches(permission, resource, action) {
        // Check resource match
        if (permission.resource !== '*' && permission.resource !== resource.type) {
            return false;
        }
        // Check action match
        if (permission.action !== '*' && permission.action !== 'manage' && permission.action !== action) {
            return false;
        }
        // 'manage' includes all CRUD actions
        if (permission.action === 'manage') {
            const manageActions = ['create', 'read', 'update', 'delete', 'list'];
            if (!manageActions.includes(action)) {
                return false;
            }
        }
        return true;
    }
    /**
     * Evaluate a condition against resource and user context
     */
    evaluateCondition(condition, resource, user) {
        // Get the actual value from resource
        let actualValue;
        if (condition.field === 'ownerId') {
            actualValue = resource.ownerId;
        }
        else if (condition.field === 'tenantId') {
            actualValue = resource.tenantId;
        }
        else if (condition.field.startsWith('attributes.')) {
            const attrKey = condition.field.slice('attributes.'.length);
            actualValue = resource.attributes?.[attrKey];
        }
        else {
            actualValue = resource.attributes?.[condition.field];
        }
        // Resolve condition value (may reference user context)
        let expectedValue = condition.value;
        if (typeof expectedValue === 'string') {
            if (expectedValue === '$user.id') {
                expectedValue = user.id;
            }
            else if (expectedValue === '$user.tenantId') {
                expectedValue = user.tenantId;
            }
            else if (expectedValue.startsWith('$user.attributes.')) {
                const attrKey = expectedValue.slice('$user.attributes.'.length);
                expectedValue = user.attributes?.[attrKey];
            }
        }
        // Evaluate based on operator
        switch (condition.operator) {
            case 'eq':
                return actualValue === expectedValue;
            case 'ne':
                return actualValue !== expectedValue;
            case 'in':
                if (!Array.isArray(expectedValue)) {
                    return false;
                }
                return expectedValue.includes(actualValue);
            case 'nin':
                if (!Array.isArray(expectedValue)) {
                    return true;
                }
                return !expectedValue.includes(actualValue);
            case 'exists':
                return expectedValue ? actualValue !== undefined && actualValue !== null : actualValue === undefined || actualValue === null;
            case 'match':
                if (typeof actualValue !== 'string' || typeof expectedValue !== 'string') {
                    return false;
                }
                try {
                    return new RegExp(expectedValue).test(actualValue);
                }
                catch {
                    return false;
                }
            default:
                return false;
        }
    }
    /**
     * Check if a user can perform an action on a resource
     */
    check(user, action, resource) {
        const permissions = this.getUserPermissions(user);
        for (const permission of permissions) {
            // Check if permission matches resource and action
            if (!this.permissionMatches(permission, resource, action)) {
                continue;
            }
            // If no conditions, permission is granted
            if (!permission.conditions || permission.conditions.length === 0) {
                return {
                    allowed: true,
                    reason: `Permission granted by ${permission.resource}:${permission.action}`,
                    matchedPermission: permission
                };
            }
            // Evaluate all conditions (AND logic)
            const conditionResults = permission.conditions.map(condition => ({
                field: condition.field,
                result: this.evaluateCondition(condition, resource, user)
            }));
            const allConditionsMet = conditionResults.every(c => c.result);
            if (allConditionsMet) {
                return {
                    allowed: true,
                    reason: `Permission granted by ${permission.resource}:${permission.action} with conditions`,
                    matchedPermission: permission,
                    conditions: conditionResults
                };
            }
        }
        return {
            allowed: false,
            reason: `No permission found for ${action} on ${resource.type}`
        };
    }
    /**
     * Check tenant isolation - ensures user can only access resources in their tenant
     */
    checkTenantIsolation(user, resource) {
        // Super admins can access any tenant
        if (user.roles.includes('super_admin')) {
            return {
                allowed: true,
                reason: 'Super admin bypasses tenant isolation'
            };
        }
        // If resource has no tenant, allow
        if (!resource.tenantId) {
            return {
                allowed: true,
                reason: 'Resource has no tenant restriction'
            };
        }
        // If user has no tenant, deny
        if (!user.tenantId) {
            return {
                allowed: false,
                reason: 'User has no tenant context'
            };
        }
        // Check tenant match
        if (user.tenantId === resource.tenantId) {
            return {
                allowed: true,
                reason: 'User tenant matches resource tenant'
            };
        }
        return {
            allowed: false,
            reason: `Tenant isolation: user tenant ${user.tenantId} cannot access resource in tenant ${resource.tenantId}`
        };
    }
    /**
     * Full authorization check including tenant isolation
     */
    authorize(user, action, resource) {
        // First check tenant isolation
        const tenantCheck = this.checkTenantIsolation(user, resource);
        if (!tenantCheck.allowed) {
            return tenantCheck;
        }
        // Then check permissions
        return this.check(user, action, resource);
    }
    /**
     * Add a custom role
     */
    addRole(role) {
        const existing = this.roles.get(role.name);
        if (existing?.system) {
            throw new Error(`Cannot override system role: ${role.name}`);
        }
        this.roles.set(role.name, role);
        // Clear cache
        this.rolePermissionsCache.clear();
    }
    /**
     * Remove a custom role
     */
    removeRole(name) {
        const role = this.roles.get(name);
        if (role?.system) {
            throw new Error(`Cannot remove system role: ${name}`);
        }
        const deleted = this.roles.delete(name);
        if (deleted) {
            this.rolePermissionsCache.clear();
        }
        return deleted;
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
export function rbacMiddleware(options = {}) {
    const { customRoles = {}, getTenantId, enforceTenantIsolation = true } = options;
    const policyEngine = new PolicyEngine(customRoles);
    return async (c, next) => {
        // Set policy engine in context
        c.set('policyEngine', policyEngine);
        // Get user from auth middleware
        const user = c.var.user;
        // Build user context
        const tenantId = getTenantId?.(c) ?? c.req.header('X-Tenant-ID');
        const userContext = {
            id: user?.id ?? 'anonymous',
            roles: user?.roles ?? ['guest'],
            ...(user?.scopes !== undefined && { permissions: user.scopes }),
            ...(tenantId !== undefined && { tenantId }),
            attributes: {}
        };
        c.set('userContext', userContext);
        c.enforceTenantIsolation = enforceTenantIsolation;
        return next();
    };
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
export function requirePermission(resource, action, getResourceContext) {
    return async (c, next) => {
        const policyEngine = c.var.policyEngine;
        const userContext = c.var.userContext;
        if (!policyEngine || !userContext) {
            throw new HTTPException(500, {
                message: 'RBAC middleware not initialized - add rbacMiddleware first'
            });
        }
        // Build resource context
        let resourceContext;
        if (getResourceContext) {
            resourceContext = await getResourceContext(c);
        }
        else {
            // Default resource context from request
            const id = c.req.param('id');
            const tenantIdHeader = c.req.header('X-Tenant-ID');
            resourceContext = {
                type: resource,
                ...(id !== undefined && { id }),
                ...(tenantIdHeader !== undefined && { tenantId: tenantIdHeader })
            };
        }
        // Check authorization
        const decision = policyEngine.authorize(userContext, action, resourceContext);
        if (!decision.allowed) {
            throw new HTTPException(403, {
                message: decision.reason
            });
        }
        return next();
    };
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
export function requireResourceOwner(getOwnerId) {
    return async (c, next) => {
        const userContext = c.var.userContext;
        if (!userContext) {
            throw new HTTPException(500, {
                message: 'RBAC middleware not initialized - add rbacMiddleware first'
            });
        }
        // Super admins and admins bypass owner check
        if (userContext.roles.includes('super_admin') || userContext.roles.includes('admin')) {
            return next();
        }
        const ownerId = await getOwnerId(c);
        if (!ownerId) {
            throw new HTTPException(404, {
                message: 'Resource not found'
            });
        }
        if (userContext.id !== ownerId) {
            throw new HTTPException(403, {
                message: 'Access denied - not resource owner'
            });
        }
        return next();
    };
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
export function requireTenantMatch(getResourceTenantId) {
    return async (c, next) => {
        const policyEngine = c.var.policyEngine;
        const userContext = c.var.userContext;
        if (!policyEngine || !userContext) {
            throw new HTTPException(500, {
                message: 'RBAC middleware not initialized - add rbacMiddleware first'
            });
        }
        const resourceTenantId = await getResourceTenantId(c);
        if (!resourceTenantId) {
            // No tenant restriction on resource
            return next();
        }
        const decision = policyEngine.checkTenantIsolation(userContext, {
            type: '*',
            tenantId: resourceTenantId
        });
        if (!decision.allowed) {
            throw new HTTPException(403, {
                message: decision.reason
            });
        }
        return next();
    };
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
export function permission(resource, action) {
    return `${resource}:${action}`;
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
export function parsePermission(permissionString) {
    const [resource, action] = permissionString.split(':');
    return {
        resource: resource || '*',
        action: action || '*'
    };
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
export function matchesPermission(permissionString, resource, action) {
    const { resource: permResource, action: permAction } = parsePermission(permissionString);
    const resourceMatches = permResource === '*' || permResource === resource;
    const actionMatches = permAction === '*' || permAction === action;
    return resourceMatches && actionMatches;
}
// ============================================================================
// Default Policy Engine Instance
// ============================================================================
/**
 * Default policy engine instance with built-in roles
 */
export const defaultPolicyEngine = new PolicyEngine();
//# sourceMappingURL=rbac.js.map