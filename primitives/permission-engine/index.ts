/**
 * @module permission-engine
 *
 * Permission Engine Primitive - Comprehensive authorization for the dotdo platform.
 *
 * Combines Role-Based Access Control (RBAC) and Attribute-Based Access Control (ABAC)
 * for fine-grained authorization. Supports role inheritance, policy evaluation with
 * deny-overrides-allow semantics, wildcards, ownership checks, and caching.
 *
 * ## Features
 *
 * - **RBAC** with role inheritance and permission aggregation
 * - **ABAC** with rich condition operators and variable substitution
 * - **Deny-overrides-allow** policy evaluation semantics
 * - **Wildcard permissions** for resources and actions
 * - **Ownership checks** for resource-owner validation
 * - **Permission caching** with TTL for performance
 * - **Audit logging** for authorization decisions
 * - **Condition operators**: eq, neq, gt, gte, lt, lte, in, nin, contains, startsWith, endsWith, matches, exists
 *
 * @example Basic RBAC Setup
 * ```typescript
 * import { PermissionEngine } from 'dotdo/primitives/permission-engine'
 *
 * const engine = new PermissionEngine({
 *   roles: [
 *     {
 *       name: 'viewer',
 *       permissions: [{ resource: 'document', actions: ['read'] }],
 *     },
 *     {
 *       name: 'editor',
 *       permissions: [{ resource: 'document', actions: ['read', 'update'] }],
 *       inherits: ['viewer'],
 *     },
 *     {
 *       name: 'admin',
 *       permissions: [{ resource: '*', actions: ['*'] }],
 *       inherits: ['editor'],
 *     },
 *   ],
 * })
 *
 * const subject = { id: 'user-123', type: 'user', roles: ['editor'], attributes: {} }
 * const resource = { id: 'doc-456', type: 'document', attributes: {} }
 *
 * const result = engine.check(subject, 'update', resource)
 * if (result.allowed) {
 *   // Proceed with action
 * }
 * ```
 *
 * @example ABAC Policy Rules
 * ```typescript
 * const engine = new PermissionEngine({
 *   roles: [{ name: 'user', permissions: [] }],
 *   policies: [
 *     {
 *       id: 'no-delete-archived',
 *       effect: 'deny',
 *       resources: ['document'],
 *       actions: ['delete'],
 *       conditions: [
 *         { field: 'resource.attributes.archived', operator: 'eq', value: true },
 *       ],
 *     },
 *     {
 *       id: 'owner-can-edit',
 *       effect: 'allow',
 *       resources: ['document'],
 *       actions: ['update', 'delete'],
 *       conditions: [
 *         { field: 'resource.owner', operator: 'eq', value: '${subject.id}' },
 *       ],
 *     },
 *   ],
 * })
 * ```
 *
 * @example Ownership-Based Access
 * ```typescript
 * const engine = new PermissionEngine({
 *   roles: [{
 *     name: 'user',
 *     permissions: [{
 *       resource: 'document',
 *       actions: ['update', 'delete'],
 *       conditions: [{ operator: 'isOwner', field: '', value: true }],
 *     }],
 *   }],
 * })
 *
 * const subject = { id: 'user-123', type: 'user', roles: ['user'], attributes: {} }
 * const myDoc = { id: 'doc-1', type: 'document', owner: 'user-123', attributes: {} }
 * const otherDoc = { id: 'doc-2', type: 'document', owner: 'user-456', attributes: {} }
 *
 * engine.check(subject, 'update', myDoc).allowed    // true (owner)
 * engine.check(subject, 'update', otherDoc).allowed // false (not owner)
 * ```
 *
 * @example Permission Caching
 * ```typescript
 * const engine = new PermissionEngine({
 *   roles: [...],
 *   enableCache: true,
 *   cacheTtl: 60000, // 1 minute TTL
 * })
 *
 * // First check - evaluated
 * engine.check(subject, 'read', resource)
 *
 * // Second check - cached result returned
 * engine.check(subject, 'read', resource)
 *
 * // Check cache stats
 * const stats = engine.getCacheStats()
 * console.log(`Hit rate: ${stats.hits / (stats.hits + stats.misses)}`)
 * ```
 *
 * @example Dynamic Role Management
 * ```typescript
 * // Grant permission to a role
 * engine.grant('editor', { resource: 'comment', actions: ['create', 'update'] })
 *
 * // Revoke permission from a role
 * engine.revoke('editor', { resource: 'comment', actions: ['delete'] })
 *
 * // Assign/remove roles from subjects
 * const updatedSubject = engine.assignRole(subject, 'admin')
 * const demotedSubject = engine.removeRole(updatedSubject, 'admin')
 * ```
 *
 * @example Check Multiple Actions
 * ```typescript
 * const result = engine.checkAll(subject, ['read', 'update', 'delete'], resource)
 * if (!result.allowed) {
 *   console.log('Failed actions:', result.context.failedActions)
 * }
 * ```
 *
 * @packageDocumentation
 */

import type {
  Permission,
  Role,
  Policy,
  Subject,
  Resource,
  Action,
  Condition,
  AuthorizationResult,
  AuthorizationReason,
  AuditLogEntry,
  PermissionEngineConfig,
  PolicyEffect,
  CacheEntry,
} from './types'

// Re-export types
export type {
  Permission,
  Role,
  Policy,
  Subject,
  Resource,
  Action,
  Condition,
  AuthorizationResult,
  AuthorizationReason,
  AuditLogEntry,
  PermissionEngineConfig,
  PolicyEffect,
  CacheEntry,
}

/**
 * Get a value from an object using dot notation path
 * @internal
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Evaluates conditions against context
 */
export class ConditionEvaluator {
  /**
   * Evaluate a single condition against context
   */
  evaluate(condition: Condition, context: Record<string, unknown>): boolean {
    const fieldValue = getNestedValue(context, condition.field)
    const targetValue = condition.value

    switch (condition.operator) {
      case 'eq':
        return fieldValue === targetValue

      case 'neq':
        return fieldValue !== targetValue

      case 'gt':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue > targetValue
        )

      case 'gte':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue >= targetValue
        )

      case 'lt':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue < targetValue
        )

      case 'lte':
        return (
          typeof fieldValue === 'number' &&
          typeof targetValue === 'number' &&
          fieldValue <= targetValue
        )

      case 'in':
        return Array.isArray(targetValue) && targetValue.includes(fieldValue)

      case 'nin':
        return Array.isArray(targetValue) && !targetValue.includes(fieldValue)

      case 'contains':
        if (typeof fieldValue === 'string' && typeof targetValue === 'string') {
          return fieldValue.includes(targetValue)
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(targetValue)
        }
        return false

      case 'startsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          fieldValue.startsWith(targetValue)
        )

      case 'endsWith':
        return (
          typeof fieldValue === 'string' &&
          typeof targetValue === 'string' &&
          fieldValue.endsWith(targetValue)
        )

      case 'matches':
        if (typeof fieldValue !== 'string' || typeof targetValue !== 'string') {
          return false
        }
        try {
          const regex = new RegExp(targetValue)
          return regex.test(fieldValue)
        } catch {
          return false
        }

      case 'exists':
        const exists = fieldValue !== undefined
        return targetValue === true ? exists : !exists

      case 'isOwner':
        // Special case: handled by PermissionEngine
        return false

      default:
        return false
    }
  }

  /**
   * Evaluate all conditions (AND logic)
   */
  evaluateAll(conditions: Condition[], context: Record<string, unknown>): boolean {
    return conditions.every((condition) => this.evaluate(condition, context))
  }
}

/**
 * Resolves role inheritance to get all effective permissions
 */
export class InheritanceResolver {
  private roles: Map<string, Role> = new Map()

  constructor(roles: Role[]) {
    for (const role of roles) {
      this.roles.set(role.name, role)
    }
  }

  /**
   * Update the roles
   */
  setRoles(roles: Role[]): void {
    this.roles.clear()
    for (const role of roles) {
      this.roles.set(role.name, role)
    }
  }

  /**
   * Get a role by name
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name)
  }

  /**
   * Resolve all permissions for a role, including inherited ones
   */
  resolvePermissions(roleName: string, visited: Set<string> = new Set()): Permission[] {
    // Prevent circular inheritance
    if (visited.has(roleName)) {
      return []
    }
    visited.add(roleName)

    const role = this.roles.get(roleName)
    if (!role) {
      return []
    }

    const permissions: Permission[] = [...role.permissions]

    // Add inherited permissions
    if (role.inherits) {
      for (const parentRoleName of role.inherits) {
        const inheritedPermissions = this.resolvePermissions(parentRoleName, visited)
        permissions.push(...inheritedPermissions)
      }
    }

    return permissions
  }
}

/**
 * Manages roles and their permissions
 */
export class RoleManager {
  private roles: Map<string, Role> = new Map()

  constructor(roles?: Role[]) {
    if (roles) {
      for (const role of roles) {
        this.roles.set(role.name, role)
      }
    }
  }

  /**
   * Add a role
   */
  addRole(role: Role): void {
    this.roles.set(role.name, role)
  }

  /**
   * Get a role by name
   */
  getRole(name: string): Role | undefined {
    return this.roles.get(name)
  }

  /**
   * Get all roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values())
  }

  /**
   * Delete a role
   */
  deleteRole(name: string): boolean {
    return this.roles.delete(name)
  }

  /**
   * Update an existing role
   */
  updateRole(name: string, updates: Partial<Omit<Role, 'name'>>): void {
    const role = this.roles.get(name)
    if (role) {
      this.roles.set(name, { ...role, ...updates })
    }
  }

  /**
   * Grant a permission to a role
   */
  grantPermission(roleName: string, permission: Permission): void {
    const role = this.roles.get(roleName)
    if (role) {
      role.permissions.push(permission)
    }
  }

  /**
   * Revoke a permission from a role
   */
  revokePermission(roleName: string, permission: Permission): void {
    const role = this.roles.get(roleName)
    if (!role) return

    // Find and remove matching permission
    const index = role.permissions.findIndex((p) => {
      if (p.resource !== permission.resource) return false
      // Remove the specified actions from this permission
      const remainingActions = p.actions.filter(
        (a) => !permission.actions.includes(a)
      )
      if (remainingActions.length === 0) {
        return true // Remove entire permission
      }
      if (remainingActions.length < p.actions.length) {
        // Update permission to have only remaining actions
        p.actions = remainingActions
      }
      return false
    })

    if (index !== -1) {
      role.permissions.splice(index, 1)
    }
  }
}

/**
 * Evaluates policies for ABAC
 */
export class PolicyEvaluator {
  private conditionEvaluator: ConditionEvaluator

  constructor() {
    this.conditionEvaluator = new ConditionEvaluator()
  }

  /**
   * Evaluate a policy against subject, action, and resource
   */
  evaluate(
    policy: Policy,
    subject: Subject,
    action: Action,
    resource: Resource
  ): { matches: boolean; effect: PolicyEffect } {
    // Skip disabled policies
    if (policy.enabled === false) {
      return { matches: false, effect: policy.effect }
    }

    // Check resource type
    if (!this.matchesResource(policy.resources, resource.type)) {
      return { matches: false, effect: policy.effect }
    }

    // Check action
    if (!this.matchesAction(policy.actions, action)) {
      return { matches: false, effect: policy.effect }
    }

    // Check conditions
    if (policy.conditions && policy.conditions.length > 0) {
      const context = this.buildContext(subject, resource)

      // Process variable substitution in condition values
      const processedConditions = policy.conditions.map((condition) => {
        if (typeof condition.value === 'string' && condition.value.startsWith('${') && condition.value.endsWith('}')) {
          const path = condition.value.slice(2, -1) // Remove ${ and }
          const resolvedValue = getNestedValue(context, path)
          return { ...condition, value: resolvedValue }
        }
        return condition
      })

      if (!this.conditionEvaluator.evaluateAll(processedConditions, context)) {
        return { matches: false, effect: policy.effect }
      }
    }

    return { matches: true, effect: policy.effect }
  }

  private matchesResource(resources: string[], resourceType: string): boolean {
    return resources.some((r) => r === '*' || r === resourceType)
  }

  private matchesAction(actions: Action[], action: Action): boolean {
    return actions.some((a) => a === '*' || a === action)
  }

  private buildContext(subject: Subject, resource: Resource): Record<string, unknown> {
    return {
      subject: {
        id: subject.id,
        type: subject.type,
        roles: subject.roles,
        attributes: subject.attributes,
      },
      resource: {
        type: resource.type,
        id: resource.id,
        owner: resource.owner,
        attributes: resource.attributes,
      },
    }
  }
}

/**
 * Caches permission decisions for performance
 */
export class PermissionCache {
  private cache: Map<string, CacheEntry> = new Map()
  private ttl: number
  private hits = 0
  private misses = 0

  constructor(options: { ttl: number }) {
    this.ttl = options.ttl
  }

  /**
   * Generate cache key
   */
  private generateKey(subjectId: string, action: Action, resourceKey: string): string {
    return `${subjectId}:${action}:${resourceKey}`
  }

  /**
   * Get cached result
   */
  get(subjectId: string, action: Action, resourceKey: string): AuthorizationResult | undefined {
    const key = this.generateKey(subjectId, action, resourceKey)
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    this.hits++
    return entry.result
  }

  /**
   * Set cached result
   */
  set(
    subjectId: string,
    action: Action,
    resourceKey: string,
    result: AuthorizationResult
  ): void {
    const key = this.generateKey(subjectId, action, resourceKey)
    const now = Date.now()
    this.cache.set(key, {
      result,
      createdAt: now,
      expiresAt: now + this.ttl,
    })
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    }
  }
}

/**
 * Logs authorization decisions for audit purposes
 */
export class AuditLogger {
  private handler: (entry: AuditLogEntry) => void | Promise<void>
  private idCounter = 0

  constructor(options: { handler: (entry: AuditLogEntry) => void | Promise<void> }) {
    this.handler = options.handler
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    this.idCounter++
    return `audit-${Date.now()}-${this.idCounter}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Log an authorization decision
   */
  async log(
    subject: Subject,
    action: Action,
    resource: Resource,
    result: AuthorizationResult,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const entry: AuditLogEntry = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      subject,
      action,
      resource,
      result,
      metadata,
    }

    await this.handler(entry)
  }
}

/**
 * Main Permission Engine class
 */
export class PermissionEngine {
  private roleManager: RoleManager
  private policyEvaluator: PolicyEvaluator
  private conditionEvaluator: ConditionEvaluator
  private inheritanceResolver: InheritanceResolver
  private cache?: PermissionCache
  private auditLogger?: AuditLogger
  private policies: Policy[]
  private defaultEffect: PolicyEffect

  constructor(config: PermissionEngineConfig = {}) {
    this.roleManager = new RoleManager(config.roles)
    this.policyEvaluator = new PolicyEvaluator()
    this.conditionEvaluator = new ConditionEvaluator()
    this.inheritanceResolver = new InheritanceResolver(config.roles || [])
    this.policies = config.policies || []
    this.defaultEffect = config.defaultEffect || 'deny'

    if (config.enableCache) {
      this.cache = new PermissionCache({ ttl: config.cacheTtl || 60000 })
    }

    if (config.enableAudit) {
      if (config.auditLogger) {
        this.auditLogger = new AuditLogger({
          handler: config.auditLogger.log.bind(config.auditLogger),
        })
      }
    }
  }

  /**
   * Check if a subject can perform an action on a resource
   */
  check(subject: Subject, action: Action, resource: Resource): AuthorizationResult {
    // Check cache first
    if (this.cache) {
      const resourceKey = `${resource.type}:${resource.id}`
      const cached = this.cache.get(subject.id, action, resourceKey)
      if (cached) {
        return cached
      }
    }

    const result = this.evaluateAuthorization(subject, action, resource)

    // Cache the result
    if (this.cache) {
      const resourceKey = `${resource.type}:${resource.id}`
      this.cache.set(subject.id, action, resourceKey, result)
    }

    // Log the decision
    if (this.auditLogger) {
      this.auditLogger.log(subject, action, resource, result)
    }

    return result
  }

  /**
   * Check multiple actions at once
   */
  checkAll(
    subject: Subject,
    actions: Action[],
    resource: Resource
  ): AuthorizationResult {
    const failedActions: Action[] = []

    for (const action of actions) {
      const result = this.check(subject, action, resource)
      if (!result.allowed) {
        failedActions.push(action)
      }
    }

    if (failedActions.length === 0) {
      return { allowed: true, reason: 'ALLOWED_BY_PERMISSION' }
    }

    return {
      allowed: false,
      reason: 'DENIED_NO_PERMISSION',
      context: { failedActions },
    }
  }

  /**
   * Internal authorization evaluation
   */
  private evaluateAuthorization(
    subject: Subject,
    action: Action,
    resource: Resource
  ): AuthorizationResult {
    // First, check deny policies (deny overrides allow)
    for (const policy of this.policies) {
      if (policy.effect === 'deny') {
        const { matches } = this.policyEvaluator.evaluate(
          policy,
          subject,
          action,
          resource
        )
        if (matches) {
          return {
            allowed: false,
            reason: 'DENIED_BY_POLICY',
            matchedPolicy: policy,
          }
        }
      }
    }

    // Check allow policies
    for (const policy of this.policies) {
      if (policy.effect === 'allow') {
        const { matches } = this.policyEvaluator.evaluate(
          policy,
          subject,
          action,
          resource
        )
        if (matches) {
          return {
            allowed: true,
            reason: 'ALLOWED_BY_POLICY',
            matchedPolicy: policy,
          }
        }
      }
    }

    // Check role-based permissions
    if (subject.roles.length === 0) {
      return { allowed: false, reason: 'DENIED_BY_DEFAULT' }
    }

    for (const roleName of subject.roles) {
      const permissions = this.inheritanceResolver.resolvePermissions(roleName)

      for (const permission of permissions) {
        const matchResult = this.matchPermission(
          permission,
          action,
          resource,
          subject
        )

        if (matchResult.matches) {
          return {
            allowed: true,
            reason: matchResult.reason,
            matchedPermission: permission,
            matchedRole: roleName,
          }
        }
      }
    }

    return { allowed: false, reason: 'DENIED_NO_PERMISSION' }
  }

  /**
   * Check if a permission matches the requested action and resource
   */
  private matchPermission(
    permission: Permission,
    action: Action,
    resource: Resource,
    subject: Subject
  ): { matches: boolean; reason: AuthorizationReason } {
    // Check resource type
    const resourceMatches =
      permission.resource === '*' || permission.resource === resource.type
    if (!resourceMatches) {
      return { matches: false, reason: 'DENIED_NO_PERMISSION' }
    }

    // Check action
    const actionMatches =
      permission.actions.includes('*') || permission.actions.includes(action)
    if (!actionMatches) {
      return { matches: false, reason: 'DENIED_NO_PERMISSION' }
    }

    // Check conditions
    if (permission.conditions && permission.conditions.length > 0) {
      const context = this.buildContext(subject, resource)

      // Check for ownership condition
      const hasOwnershipCondition = permission.conditions.some(
        (c) => c.operator === 'isOwner'
      )

      if (hasOwnershipCondition) {
        if (resource.owner === subject.id) {
          return { matches: true, reason: 'ALLOWED_BY_OWNERSHIP' }
        }
        return { matches: false, reason: 'DENIED_CONDITION_FAILED' }
      }

      // Evaluate other conditions
      const conditionsPass = permission.conditions.every((condition) => {
        return this.conditionEvaluator.evaluate(condition, context)
      })

      if (!conditionsPass) {
        return { matches: false, reason: 'DENIED_CONDITION_FAILED' }
      }
    }

    // Determine reason
    if (permission.resource === '*' || permission.actions.includes('*')) {
      return { matches: true, reason: 'ALLOWED_BY_WILDCARD' }
    }

    return { matches: true, reason: 'ALLOWED_BY_PERMISSION' }
  }

  private buildContext(subject: Subject, resource: Resource): Record<string, unknown> {
    return {
      subject: {
        id: subject.id,
        type: subject.type,
        roles: subject.roles,
        attributes: subject.attributes,
      },
      resource: {
        type: resource.type,
        id: resource.id,
        owner: resource.owner,
        attributes: resource.attributes,
      },
    }
  }

  /**
   * Grant a permission to a role
   */
  grant(roleName: string, permission: Permission): void {
    this.roleManager.grantPermission(roleName, permission)
    // Update inheritance resolver
    this.inheritanceResolver.setRoles(this.roleManager.getAllRoles())
    // Invalidate cache
    this.cache?.clear()
  }

  /**
   * Revoke a permission from a role
   */
  revoke(roleName: string, permission: Permission): void {
    this.roleManager.revokePermission(roleName, permission)
    // Update inheritance resolver
    this.inheritanceResolver.setRoles(this.roleManager.getAllRoles())
    // Invalidate cache
    this.cache?.clear()
  }

  /**
   * Assign a role to a subject
   */
  assignRole(subject: Subject, roleName: string): Subject {
    if (subject.roles.includes(roleName)) {
      return subject // Already has role
    }
    return {
      ...subject,
      roles: [...subject.roles, roleName],
    }
  }

  /**
   * Remove a role from a subject
   */
  removeRole(subject: Subject, roleName: string): Subject {
    return {
      ...subject,
      roles: subject.roles.filter((r) => r !== roleName),
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number } {
    return this.cache?.getStats() || { hits: 0, misses: 0, size: 0 }
  }

  /**
   * Get the role manager
   */
  getRoleManager(): RoleManager {
    return this.roleManager
  }

  /**
   * Get the policy evaluator
   */
  getPolicyEvaluator(): PolicyEvaluator {
    return this.policyEvaluator
  }
}

/**
 * Create a permission engine with the given configuration
 * Convenience factory function
 */
export function createPermissionEngine(
  config: PermissionEngineConfig = {}
): PermissionEngine {
  return new PermissionEngine(config)
}
